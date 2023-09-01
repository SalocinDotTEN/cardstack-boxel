import { module, test } from 'qunit';
import {
  find,
  findAll,
  visit,
  currentURL,
  click,
  waitFor,
  fillIn,
  waitUntil,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  testRealmURL,
  type TestContextWithSSE,
} from '../helpers';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import type LoaderService from '@cardstack/host/services/loader-service';
import percySnapshot from '@percy/ember';
import { setupWindowMock } from 'ember-window-mock/test-support';
import window from 'ember-window-mock';

function getMonacoContent(): string {
  return (window as any).monaco.editor.getModels()[0].getValue();
}

const indexCardSource = `
  import { CardDef, Component } from "https://cardstack.com/base/card-api";

  export class Index extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-index-card>
          Hello, world!
        </div>
      </template>
    };
  }
`;

const personCardSource = `
  import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
        </div>
        <style>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

module('Acceptance | basic tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    adapter = new TestRealmAdapter({
      'index.gts': indexCardSource,
      'person.gts': personCardSource,
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `./person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'index.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: './index',
              name: 'Index',
            },
          },
        },
      },
      'Person/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
    });

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
    });
    await realm.ready;
  });

  test('visiting / (there is no realm here)', async function (assert) {
    await visit('/');

    assert.strictEqual(currentURL(), '/');
    assert
      .dom('[data-test-moved]')
      .containsText('The card code editor has moved to /code');
    await click('[data-test-code-link]');
    assert.strictEqual(currentURL(), '/code');
  });

  test('visiting realm root', async function (assert) {
    await visit('/test/');

    assert.strictEqual(currentURL(), '/test/');
    assert.dom('[data-test-index-card]').containsText('Hello, world');
    assert
      .dom('[data-test-moved]')
      .containsText('The card code editor has moved to /code');
    await click('[data-test-code-link]');
    assert.strictEqual(currentURL(), '/code');
  });

  test('Can expand/collapse directories file tree', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    assert
      .dom('[data-test-directory="Person/"]')
      .exists('Person/ directory entry is rendered');
    assert
      .dom('[data-test-file="person.gts"]')
      .exists('person.gts file entry is rendered');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    await click('[data-test-directory="Person/"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .doesNotExist('Person/1.json file entry is not rendered');
  });

  test('recent file links are shown', async function (assert) {
    window.localStorage.setItem('recent-files', JSON.stringify(['index.json']));

    console.log('visiting code');
    await visit('/code');

    await waitFor('[data-test-file]');

    assert
      .dom('[data-test-recent-file]')
      .exists({ count: 1 })
      .containsText('index.json');

    await click('[data-test-file="index.json"]');
    assert.dom('[data-test-recent-file]').doesNotExist();

    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');

    await click('[data-test-file="Person/1.json"]');

    assert
      .dom('[data-test-recent-file]')
      .exists({ count: 1 })
      .containsText('index.json');

    await click('[data-test-file="person.gts"]');

    assert
      .dom('[data-test-recent-file]:first-child')
      .containsText('Person/1.json');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('index.json');

    await click('[data-test-recent-file]:nth-child(2)');
    assert.dom('[data-test-index-card]').exists('index card is rendered');

    assert
      .dom('[data-test-recent-file]:first-child')
      .containsText('person.gts');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('Person/1.json');

    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('recent-files') || '[]'),
      ['index.json', 'person.gts', 'Person/1.json'],
    );
  });

  test('Can view a card instance', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');

    await click('[data-test-file="Person/1.json"]');

    assert.strictEqual(
      currentURL(),
      '/code?openDirs=Person%2F&path=Person%2F1.json',
    );
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    assert.dom('[data-test-person]').containsText('First name: Hassan');
    assert.dom('[data-test-person]').containsText('Last name: Abdel-Rahman');
    assert.dom('[data-test-person]').containsText('Title: Hassan Abdel-Rahman');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
        },
        meta: {
          adoptsFrom: {
            module: `../person`,
            name: 'Person',
          },
        },
      },
    });

    assert.dom('[data-test-person]').hasStyle(
      {
        color: 'rgb(0, 128, 0)',
      },
      'expected scoped CSS to apply to card instance',
    );

    await waitForSyntaxHighlighting('"Person"', 'rgb(4, 81, 165)');
    await percySnapshot(assert);
  });

  test<TestContextWithSSE>('Card instance live updates when index changes', async function (assert) {
    let expectedEvents = [
      `index-invalidation: ["${testRealmURL}Person/1"]`,
      'index: incremental',
    ];

    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');
    await click('[data-test-file="Person/1.json"]');

    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await realm.write(
          'Person/1.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                firstName: 'HassanXXX',
              },
              meta: {
                adoptsFrom: {
                  module: '../person',
                  name: 'Person',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-person]')!
          .textContent?.includes('HassanXXX'),
    );
    assert.dom('[data-test-person]').containsText('First name: HassanXXX');
  });

  test('Can view a card schema', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-file="person.gts"]');
    await waitFor('[data-test-card-id]');

    assert.strictEqual(currentURL(), '/code?path=person.gts');
    assert
      .dom('[data-test-card-id]')
      .containsText(`${testRealmURL}person/Person`);
    assert
      .dom('[data-test-adopts-from]')
      .containsText(`${baseRealm.url}card-api/Card`);
    assert.dom('[data-test-field="firstName"]').exists();
    assert.dom('[data-test-field="lastName"]').exists();
    assert.strictEqual(
      getMonacoContent(),
      personCardSource,
      'the monaco content is correct',
    );

    // Syntax highlighting is breadth-first, this is the latest and deepest token
    await waitForSyntaxHighlighting("''", 'rgb(163, 21, 21)');
    await waitFor('[data-test-boxel-card-container] [data-test-description]');

    await percySnapshot(assert);
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/code');

    const buttonElement = find('[data-test-create-new-card-button]');

    assert.ok(buttonElement);

    if (!buttonElement) {
      throw new Error('[data-test-create-new-card-button] element not found');
    }

    const buttonElementScopedCssAttribute = Array.from(buttonElement.attributes)
      .map((attribute) => attribute.localName)
      .find((attributeName) => attributeName.startsWith('data-scopedcss'));

    if (!buttonElementScopedCssAttribute) {
      throw new Error(
        'Scoped CSS attribute not found on [data-test-create-new-card-button]',
      );
    }

    assert.dom('[data-test-create-new-card-button] + style').doesNotExist();
  });

  test('can create a new card', async function (assert) {
    await visit('/code');
    await click('[data-test-create-new-card-button]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Mango');
    await fillIn('[data-test-field="lastName"] input', 'Abdel-Rahman');
    await fillIn('[data-test-field="description"] input', 'Person');
    await fillIn('[data-test-field="thumbnailURL"] input', './mango.png');
    await click('[data-test-save-card]');
    await waitUntil(() => currentURL() === '/code?path=Person%2F2.json');

    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/2.json"]');
    assert
      .dom('[data-test-file="Person/2.json"]')
      .exists('Person/2.json file entry is rendered');
    assert.dom('[data-test-person]').containsText('First name: Mango');
    assert.dom('[data-test-person]').containsText('Last name: Abdel-Rahman');
    assert.dom('[data-test-person]').containsText('Title: Mango Abdel-Rahman');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
          lastName: 'Abdel-Rahman',
          description: 'Person',
          thumbnailURL: './mango.png',
        },
        meta: {
          adoptsFrom: {
            module: `../person`,
            name: 'Person',
          },
        },
      },
    });
    let fileRef = await adapter.openFile('Person/2.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
            description: 'Person',
            thumbnailURL: './mango.png',
          },
          meta: {
            adoptsFrom: {
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct',
    );
  });
});

async function waitForSyntaxHighlighting(textContent: string, color: string) {
  let codeTokens;
  let finalHighlightedToken: Element | undefined;

  await waitUntil(
    () => {
      codeTokens = findAll('.view-line span span');
      finalHighlightedToken = codeTokens.find(
        (t) => t.innerHTML === textContent,
      );
      return finalHighlightedToken;
    },
    { timeoutMessage: `timed out waiting for \`${textContent}\` token` },
  );

  await waitUntil(
    () =>
      finalHighlightedToken?.computedStyleMap()?.get('color')?.toString() ===
      color,
    { timeoutMessage: 'timed out waiting for syntax highlighting' },
  );
}
