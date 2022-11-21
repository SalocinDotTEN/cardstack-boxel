import {
  type Card,
  type CardConstructor,
  type Field,
} from "https://cardstack.com/base/card-api";
import { Loader } from "./loader";
import { isField } from "./constants";

export type CardRef =
  | {
      module: string;
      name: string;
    }
  | {
      type: "ancestorOf";
      card: CardRef;
    }
  | {
      type: "fieldOf";
      card: CardRef;
      field: string;
    };

let typesCache = new WeakMap<typeof Card, CardRef>();

export function isCardRef(ref: any): ref is CardRef {
  if (typeof ref !== "object") {
    return false;
  }
  if (!("type" in ref)) {
    if (!("module" in ref) || !("name" in ref)) {
      return false;
    }
    return typeof ref.module === "string" && typeof ref.name === "string";
  } else if (ref.type === "ancestorOf") {
    if (!("card" in ref)) {
      return false;
    }
    return isCardRef(ref.card);
  } else if (ref.type === "fieldOf") {
    if (!("card" in ref) || !("field" in ref)) {
      return false;
    }
    if (typeof ref.card !== "object" || typeof ref.field !== "string") {
      return false;
    }
    return isCardRef(ref.card);
  }
  return false;
}

export async function loadCard(
  ref: CardRef,
  opts?: { loader?: Loader }
): Promise<typeof Card | undefined> {
  let maybeCard: unknown;
  let canonicalRef: CardRef | undefined;
  let loader = opts?.loader ?? Loader.getLoader();
  if (!("type" in ref)) {
    let module = await loader.import<Record<string, any>>(ref.module);
    maybeCard = module[ref.name];
    canonicalRef = { ...ref, ...identifyCard(maybeCard as typeof Card) };
  } else if (ref.type === "ancestorOf") {
    let { card: child, ref: childRef } = (await loadCard(ref.card, opts)) ?? {};
    if (!child || !childRef) {
      return undefined;
    }
    maybeCard = Reflect.getPrototypeOf(child) as typeof Card;
    let cardId = identifyCard(maybeCard as typeof Card);
    if (cardId) {
      if (!typesCache.has(maybeCard as typeof Card)) {
        typesCache.set(maybeCard as typeof Card, cardId);
      }
    }
    canonicalRef = cardId ? cardId : { ...ref, card: childRef };
  } else if (ref.type === "fieldOf") {
    let { card: parent, ref: parentRef } =
      (await loadCard(ref.card, opts)) ?? {};
    if (!parent || !parentRef) {
      return undefined;
    }
    let field = getField(parent, ref.field);
    maybeCard = field?.card;
    let cardId = identifyCard(maybeCard as typeof Card);
    canonicalRef = cardId ? cardId : { ...ref, card: parentRef };
  } else {
    throw assertNever(ref);
  }

  if (
    typeof maybeCard === "function" &&
    "baseCard" in maybeCard &&
    canonicalRef
  ) {
    return {
      card: maybeCard as unknown as typeof Card,
      ref: canonicalRef,
    };
  } else {
    return undefined;
  }
}

export function identifyCard(card: typeof Card): CardRef | undefined {
  let cached = typesCache.get(card);
  if (cached) {
    return cached;
  }
  return Loader.identify(card);
}

export function getField<CardT extends CardConstructor>(
  card: CardT,
  fieldName: string
): Field<CardConstructor> | undefined {
  let obj: object | null = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result: Field<CardConstructor> | undefined = (desc?.get as any)?.[
      isField
    ];
    if (result !== undefined) {
      let ref = identifyCard(card);
      if (ref) {
        // is this the right place to set typesCache?
        // skip id and primitive fields?
        if (!typesCache.has(card)) {
          typesCache.set(card, ref);
        }
        let innerRef = identifyCard(result.card);
        if (innerRef) {
          if (!typesCache.has(result.card)) {
            typesCache.set(result.card, innerRef);
          }
        } else {
          typesCache.set(result.card, {
            type: "fieldOf",
            field: fieldName,
            card: ref,
          });
        }
      } else {
        console.log(`could not identify card ${card.name}`);
      }
      return result;
    }
    obj = Reflect.getPrototypeOf(obj);
  }
  return undefined;
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
