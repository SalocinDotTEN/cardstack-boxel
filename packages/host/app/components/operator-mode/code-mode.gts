import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { action } from '@ember/object';
import MonacoService from '@cardstack/host/services/monaco-service';
import { htmlSafe } from '@ember/template';
import {
  type RealmInfo,
  type SingleCardDocument,
  RealmPaths,
  isCardDocument,
  isSingleCardDocument,
} from '@cardstack/runtime-common';
import merge from 'lodash/merge';
import { file, type FileResource } from '@cardstack/host/resources/file';
import { LoadingIndicator } from '@cardstack/boxel-ui';
import { maybe } from '@cardstack/host/resources/maybe';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type MessageService from '@cardstack/host/services/message-service';
import CardService from '@cardstack/host/services/card-service';
import { task, restartableTask, timeout } from 'ember-concurrency';
import { registerDestructor } from '@ember/destroyable';
import perform from 'ember-concurrency/helpers/perform';
import CardURLBar from '@cardstack/host/components/operator-mode/card-url-bar';
import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

interface Signature {
  Args: {};
}

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked private realmInfo: RealmInfo | null = null;
  @tracked private loadFileError: string | null = null;
  @tracked private maybeMonacoSDK: MonacoSDK | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;

  constructor(args: any, owner: any) {
    super(args, owner);
    this.fetchCodeModeRealmInfo.perform();
    let url = `${this.cardService.defaultURL}_message`;
    this.subscription = {
      url,
      unsubscribe: this.messageService.subscribe(
        url,
        ({ type, data: dataStr }) => {
          if (type !== 'index') {
            return;
          }
          let card = this.cardResource.value;
          let data = JSON.parse(dataStr);
          if (!card || data.type !== 'incremental') {
            return;
          }
          let invalidations = data.invalidations as string[];
          if (invalidations.includes(card.id)) {
            this.reloadCard.perform();
          }
        },
      ),
    };
    registerDestructor(this, () => {
      this.subscription?.unsubscribe();
    });
    this.loadMonaco.perform();
  }

  private get backgroundURL() {
    return this.realmInfo?.backgroundURL;
  }

  private get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  private get realmIconURL() {
    return this.realmInfo?.iconURL;
  }

  @action private resetLoadFileError() {
    this.loadFileError = null;
  }

  private fetchCodeModeRealmInfo = restartableTask(async () => {
    if (!this.codePath) {
      return;
    }

    let realmURL = this.cardService.getRealmURLFor(this.codePath);
    if (!realmURL) {
      this.realmInfo = null;
    } else {
      this.realmInfo = await this.cardService.getRealmInfoByRealmURL(realmURL);
    }
  });

  private get isLoading() {
    return (
      this.loadMonaco.isRunning || this.openFile.current?.state === 'loading'
    );
  }

  private get isReady() {
    return this.maybeMonacoSDK && this.openFile.current?.state === 'ready';
  }

  private loadMonaco = task(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get fileContent() {
    if (this.openFile.current?.state === 'ready') {
      return this.openFile.current.content;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  private get monacoSDK() {
    if (this.maybeMonacoSDK) {
      return this.maybeMonacoSDK;
    }
    throw new Error(`cannot use monaco SDK before it has loaded`);
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  private openFile = maybe(this, (context) => {
    if (!this.codePath) {
      return undefined;
    }

    let realmURL = this.cardService.getRealmURLFor(this.codePath);
    if (!realmURL) {
      return undefined;
    }

    const realmPaths = new RealmPaths(realmURL);
    const relativePath = realmPaths.local(this.codePath);
    if (relativePath) {
      return file(context, () => ({
        relativePath,
        realmURL: realmPaths.url,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.loadFileError = 'File is not found';
          }
        },
      }));
    } else {
      return undefined;
    }
  });

  private reloadCard = restartableTask(async () => {
    await this.cardResource.load();
  });

  @use private cardResource = resource(() => {
    let isFileReady =
      this.openFile.current?.state === 'ready' &&
      this.openFile.current.name.endsWith('.json');
    const state: {
      isLoading: boolean;
      value: CardDef | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: isFileReady,
      value: null,
      error:
        this.openFile.current?.state == 'not-found'
          ? new Error('File not found')
          : undefined,
      load: async () => {
        state.isLoading = true;
        try {
          let currentlyOpenedFile = this.openFile.current as any;
          let cardDoc = JSON.parse(currentlyOpenedFile.content);
          if (isCardDocument(cardDoc)) {
            let url = currentlyOpenedFile.url.replace(/\.json$/, '');
            state.value = await this.cardService.loadModel(url);
          }
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    if (isFileReady) {
      state.load();
    }
    return state;
  });

  private contentChangedTask = restartableTask(async (content: string) => {
    await timeout(500);
    if (
      this.openFile.current?.state !== 'ready' ||
      content === this.openFile.current?.content
    ) {
      return;
    }

    let isJSON = this.openFile.current.name.endsWith('.json');
    let json = isJSON && this.safeJSONParse(content);

    // Here lies the difference in how json files and other source code files
    // are treated during editing in the code editor
    if (json && isSingleCardDocument(json)) {
      // writes json instance but doesn't update state of the file resource
      // relies on message service subscription to update state
      await this.saveFileSerializedCard(json);
      return;
    } else {
      //writes source code and updates the state of the file resource
      await this.writeSourceCodeToFile(this.openFile.current, content);
    }
  });

  private writeSourceCodeToFile(file: FileResource, content: string) {
    if (file.state !== 'ready')
      throw new Error('File is not ready to be written to');

    return file.write(content);
  }

  private safeJSONParse(content: string) {
    try {
      return JSON.parse(content);
    } catch (err) {
      log.warn(
        `content for ${this.args.openFiles.path} is not valid JSON, skipping write`,
      );
      return;
    }
  }

  // TODO turn this into a task!!
  private async saveFileSerializedCard(json: SingleCardDocument) {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    let url = realmPath.fileURL(
      this.args.openFiles.path!.replace(/\.json$/, ''),
    );

    let doc = this.reverseFileSerialization(json, url.href);
    let card: CardDef | undefined;
    try {
      card = await this.cardService.createFromSerialized(doc.data, doc, url);
    } catch (e) {
      console.error(
        'JSON is not a valid card--TODO this should be an error message in the code editor',
      );
      return;
    }

    try {
      await this.cardService.saveModel(card);
      await this.loadCard.perform(url);
    } catch (e) {
      console.error('Failed to save single card document', e);
    }
  }

  private get language(): string | undefined {
    if (this.codePath) {
      const editorLanguages = this.monacoSDK.languages.getLanguages();
      let extension = '.' + this.codePath.href.split('.').pop();
      let language = editorLanguages.find((lang) =>
        lang.extensions?.find((ext) => ext === extension),
      );
      return language?.id ?? 'plaintext';
    }
    return undefined;
  }

  // File serialization is a special type of card serialization that the host would
  // otherwise not encounter, but it does here since it's using the accept header
  // application/vnd.card+source to load the file that we see in monaco. This is
  // the only place that we use this accept header for loading card instances--everywhere
  // else we use application/vnd.card+json. Because of this the resulting JSON has
  // different semantics than the host would normally encounter--for instance, this
  // file serialization format is always missing an ID (because the ID is the filename).
  // Whereas for card isntances obtained via application/vnd.card+json, a missing ID
  // means that the card is not saved.
  //
  // In order to prevent confusion around which type of serialization you are dealing
  // with, we convert the file serialization back to the form the host is accustomed
  // to (application/vnd.card+json) as soon as possible so that the semantics around
  // file serialization don't leak outside of where they are immediately used.

  // TODO probably move this into monaco service?
  private reverseFileSerialization(
    fileSerializationJSON: SingleCardDocument,
    id: string,
  ): SingleCardDocument {
    let realmURL = this.cardService.getRealmURLFor(new URL(id))?.href;
    if (!realmURL) {
      throw new Error(`Could not determine realm for url ${id}`);
    }
    return merge({}, fileSerializationJSON, {
      data: {
        id,
        type: 'card',
        meta: {
          realmURL,
        },
      },
    });
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>
    <CardURLBar
      @onEnterPressed={{perform this.fetchCodeModeRealmInfo}}
      @loadFileError={{this.loadFileError}}
      @resetLoadFileError={{this.resetLoadFileError}}
      @realmInfo={{this.realmInfo}}
      class='card-url-bar'
    />
    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column'>
          {{! Move each container and styles to separate component }}
          <div class='inner-container'>
            Inheritance / File Browser
            <section class='inner-container__content'></section>
          </div>
          <aside class='inner-container'>
            <header class='inner-container__header'>
              Recent Files
            </header>
            <section class='inner-container__content'></section>
          </aside>
        </div>
        <div class='column'>
          <div class='inner-container'>
            {{#if this.isReady}}
              <div
                class='monaco-container'
                data-test-editor
                {{monacoModifier
                  content=this.fileContent
                  contentChanged=(perform this.contentChangedTask)
                  monacoSDK=this.monacoSDK
                  language=this.language
                }}
              ></div>
            {{else if this.isLoading}}
              <LoadingIndicator />
            {{/if}}
          </div>
        </div>
        <div class='column'>
          <div class='inner-container'>
            {{#if this.cardResource.value}}
              <CardPreviewPanel
                @card={{this.cardResource.value}}
                @realmIconURL={{this.realmIconURL}}
                data-test-card-resource-loaded
              />
            {{else if this.cardResource.error}}
              {{this.cardResource.error.message}}
            {{/if}}
          </div>
        </div>
      </div>
    </div>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
        --code-mode-column-min-width: calc(
          var(--operator-mode-min-width) - 2 * var(--boxel-sp)
        );
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
      }

      .code-mode-background {
        position: fixed;
        left: 0;
        right: 0;
        display: block;
        width: 100%;
        height: 100%;
        filter: blur(15px);
        background-size: cover;
      }

      .columns {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        gap: var(--boxel-sp-lg);
        height: 100%;
      }
      .column {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-width: var(--code-mode-column-min-width);
      }
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
        background-color: var(--boxel-200);
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
      }
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
      }
      .card-url-bar {
        position: absolute;
        top: var(--boxel-sp);
        left: calc(var(--submode-switcher-width) + (var(--boxel-sp) * 2));

        --card-url-bar-width: calc(
          100% - (var(--submode-switcher-width) + (var(--boxel-sp) * 3))
        );
        height: var(--submode-switcher-height);

        z-index: 2;
      }

      .monaco-container {
        height: 100%;
      }
    </style>
  </template>
}
