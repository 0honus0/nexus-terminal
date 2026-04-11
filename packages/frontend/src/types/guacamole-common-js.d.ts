declare module 'guacamole-common-js' {
  export interface GuacamoleStatus {
    code?: number;
    message?: string;
  }

  export interface InputStream {}
  export interface OutputStream {}

  export class Tunnel {
    onerror?: (status: GuacamoleStatus) => void;
  }

  export class WebSocketTunnel extends Tunnel {
    constructor(url: string);
  }

  export class DisplayLayer {
    getElement(): HTMLElement;
  }

  export class Display {
    getElement(): HTMLElement;
    showCursor(shown: boolean): void;
    getCursorLayer(): DisplayLayer | null;
  }

  export class Client {
    constructor(tunnel: Tunnel);
    keepAliveFrequency?: number;
    onstatechange?: ((state: number) => void) | null;
    onerror?: ((status: GuacamoleStatus) => void) | null;
    onclipboard?: ((stream: InputStream, mimetype: string) => void) | null;
    getDisplay(): Display;
    connect(data: string): void;
    disconnect(): void;
    sendMouseState(state: Mouse.State): void;
    sendKeyEvent(pressed: number, keysym: number): void;
    sendSize(width: number, height: number): void;
    createClipboardStream(mimetype: string): OutputStream;
  }

  export namespace Mouse {
    export interface State {
      x: number;
      y: number;
      left: boolean;
      middle: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
    }
  }

  export class Mouse {
    constructor(element: HTMLElement);
    onmousedown?: ((state: Mouse.State) => void) | null;
    onmouseup?: ((state: Mouse.State) => void) | null;
    onmousemove?: ((state: Mouse.State) => void) | null;
  }

  export class Keyboard {
    constructor(element: HTMLElement);
    onkeydown?: ((keysym: number) => void) | null;
    onkeyup?: ((keysym: number) => void) | null;
  }

  export class StringWriter {
    constructor(stream: OutputStream);
    sendText(text: string): void;
    sendEnd(): void;
  }

  export class StringReader {
    constructor(stream: InputStream);
    ontext?: (chunk: string) => void;
    onend?: () => void;
  }

  declare const Guacamole: {
    WebSocketTunnel: typeof WebSocketTunnel;
    Client: typeof Client;
    Mouse: typeof Mouse;
    Keyboard: typeof Keyboard;
    StringWriter: typeof StringWriter;
    StringReader: typeof StringReader;
  };

  export default Guacamole;
}
