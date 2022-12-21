// this file should be portable to both DOM and ServiceWorker contexts. It
// establishes the common API between them.

export interface RequestDirectoryHandle {
  type: 'requestDirectoryHandle';
}
export interface SetDirectoryHandleAcknowledged {
  type: 'setDirectoryHandleAcknowledged';
  url: string;
}

export interface DirectoryHandleResponse {
  type: 'directoryHandleResponse';
  handle: FileSystemDirectoryHandle | null;
  url: string | null;
}

export interface SetDirectoryHandle {
  type: 'setDirectoryHandle';
  handle: FileSystemDirectoryHandle | null;
}

export interface VisitRequest {
  type: 'visitRequest';
  id: string;
  path: string;
  staticResponses: Map<string, string>;
}

export interface VisitResponse {
  type: 'visitResponse';
  id: string;
  html: string;
  path: string;
}

export type ClientMessage =
  | RequestDirectoryHandle
  | SetDirectoryHandle
  | VisitResponse;
export type WorkerMessage =
  | DirectoryHandleResponse
  | SetDirectoryHandleAcknowledged
  | VisitRequest;
export type Message = ClientMessage | WorkerMessage;

function isMessageLike(
  maybeMessage: unknown
): maybeMessage is { type: string } {
  return (
    typeof maybeMessage === 'object' &&
    maybeMessage !== null &&
    'type' in maybeMessage &&
    typeof (maybeMessage as any).type === 'string'
  );
}

export function isClientMessage(message: unknown): message is ClientMessage {
  if (!isMessageLike(message)) {
    return false;
  }
  switch (message.type) {
    case 'requestDirectoryHandle':
      return true;
    case 'setDirectoryHandle':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle)
      );
    case 'visitResponse':
      return (
        'id' in message &&
        typeof message.id === 'string' &&
        'html' in message &&
        typeof message.html === 'string' &&
        'path' in message &&
        typeof message.path === 'string'
      );
    default:
      return false;
  }
}

export function isWorkerMessage(message: unknown): message is WorkerMessage {
  if (!isMessageLike(message)) {
    return false;
  }
  switch (message.type) {
    case 'directoryHandleResponse':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle) &&
        'url' in message &&
        ((message as any).url === null ||
          typeof (message as any).url === 'string')
      );
    case 'setDirectoryHandleAcknowledged':
      return 'url' in message && typeof (message as any).url === 'string';
    case 'visitRequest':
      return (
        'id' in message &&
        typeof message.id === 'string' &&
        'path' in message &&
        typeof message.path === 'string' &&
        'staticResponses' in message &&
        message.staticResponses instanceof Map
      );
    default:
      return false;
  }
}

interface Destination {
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
}

export function send(destination: Destination, message: Message): void {
  destination.postMessage(message);
}
