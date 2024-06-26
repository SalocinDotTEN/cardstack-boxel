import { TemplateFactory } from 'htmlbars-inline-precompile';
import '@glint/environment-ember-loose/registry';
import '@glint/environment-ember-loose/native-integration';
import { ComponentLike } from '@glint/template';
import 'ember-freestyle/glint';

import type EmberContextTemplateRegistry from 'ember-provide-consume-context/template-registry';

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry
    extends EmberContextTemplateRegistry /* other addon registries */ {
    // local entries
  }
}

// Types for compiled templates
declare module '@cardstack/host/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare global {
  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  interface Window {
    test__refreshOverlayedButtons: () => void;
  }
}

declare module '@ember/component' {
  export function setComponentTemplate(
    template: string,
    Component: ComponentLike,
  ): void;
}

// runtime-common has its own global type declaration that we need to
// incorporate
import '../../runtime-common/global';
