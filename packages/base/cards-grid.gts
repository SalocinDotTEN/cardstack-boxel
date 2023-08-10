import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  contains,
  field,
  Component,
  Card,
  realmInfo,
  realmURL,
  relativeTo,
  type CardBase,
} from './card-api';
import { IconButton, Tooltip } from '@cardstack/boxel-ui';
import {
  chooseCard,
  catalogEntryRef,
  getCards,
  baseRealm,
  cardTypeDisplayName,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { type CatalogEntry } from './catalog-entry';
import StringCard from './string';

// We pass a handle on the search refresh so that the outside
// can trigger timely refreshes of this grid
(globalThis as any).__cardsGrids = new WeakMap<Isolated, () => void>();

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <ul class='cards-grid__cards' data-test-cards-grid-cards>
        {{#each this.request.instances as |card|}}
          <li
            {{@context.cardComponentModifier
              card=card
              format='data'
              fieldType=undefined
              fieldName=undefined
            }}
            data-test-cards-grid-item={{card.id}}
          >
            <div class='grid-card'>
              <div class='grid-card__thumbnail'>
                <div
                  class='grid-card__thumbnail-text'
                  data-test-cards-grid-item-thumbnail-text
                >{{cardTypeDisplayName card}}</div>
              </div>
              <h3
                class='grid-card__title'
                data-test-cards-grid-item-title
              >{{card.title}}</h3>
              <h4
                class='grid-card__display-name'
                data-test-cards-grid-item-display-name
              >{{cardTypeDisplayName card}}</h4>
            </div>
          </li>
        {{else}}
          {{#if this.request.isLoading}}
            Loading...
          {{else}}
            <p>No cards available</p>
          {{/if}}
        {{/each}}
      </ul>

      {{#if @context.actions.createCard}}
        <div class='cards-grid__add-button'>
          <Tooltip @placement='left' @offset={{6}}>
            <:trigger>
              <IconButton
                @icon='icon-plus-circle'
                @width='40px'
                @height='40px'
                class='add-button'
                {{on 'click' this.createNew}}
                data-test-create-new-card-button
              />
            </:trigger>
            <:content>
              Add a new card to this collection
            </:content>
          </Tooltip>
        </div>
      {{/if}}
    </div>
  </template>

  @tracked
  private declare request: { instances: Card[]; isLoading: boolean };

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.refresh();

    (globalThis as any).__cardsGrids.set(
      this.args.model,
      this.refresh.bind(this),
    );
  }

  private refresh() {
    this.request = getCards(
      {
        filter: {
          not: {
            any: [
              { type: catalogEntryRef },
              {
                type: {
                  module: `${baseRealm.url}cards-grid`,
                  name: 'CardsGrid',
                },
              },
            ],
          },
        },
        // sorting by title so that we can maintain stability in
        // the ordering of the search results (server sorts results
        // by order indexed by default)
        sort: [
          {
            on: {
              module: `${baseRealm.url}card-api`,
              name: 'Card',
            },
            by: 'title',
          },
        ],
      },
      this.args.model[realmURL] ? [this.args.model[realmURL].href] : undefined,
    );
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isPrimitive: false },
      },
    });
    if (!card) {
      return;
    }

    // before auto save we used to add the new card to the stack
    // after it was created. now this no longer really makes sense
    // after auto-save. The card is in the stack in an edit mode.
    //if the user wants to view the card in isolated mode they can
    // just toggle the edit button. otherwise we'll pop 2 of the
    // same cards into the stack.
    await this.args.context?.actions?.createCard?.(
      card.ref,
      this.args.model[relativeTo],
    );
  });
}

export class CardsGrid extends Card {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
  @field realmName = contains(StringCard, {
    computeVia: function (this: CardsGrid) {
      return this[realmInfo]?.name;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: CardsGrid) {
      return this.realmName;
    },
  });

  static getDisplayName(instance: CardBase) {
    return instance[realmInfo]?.name ?? this.displayName;
  }
}
