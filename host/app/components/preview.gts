import Component from '@glint/environment-ember-loose/glimmer-component';
import { importResource } from '../resources/import';

export default class Preview extends Component<{ Args: { filename: string } }> {
  <template>
    {{#if this.error}}
      <h2>Encountered {{this.error.type}} error</h2>
      <pre>{{this.error.message}}</pre>
    {{else if this.component}}
      <this.component />
    {{/if}}
  </template>

  imported = importResource(this, () => new URL(this.args.filename, 'http://local-realm/'));

  get component() {
    return this.imported.module?.component;
  }
  get error() {
    return this.imported.error;
  }
}