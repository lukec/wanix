const CONTROL_KEY = "__wanixRemoteImport";
const CONTROL_ATTACHED = "attached";
const CONTROL_CLOSE = "close";
const CONTROL_CLOSED = "closed";
const STATE_KEY = "__wanixRemoteImportState";
const STATE_CLAIMED = "claimed";
const STATE_REVOKED = "revoked";

function controlMessage(kind) {
    return { [CONTROL_KEY]: kind };
}

function controlKind(value) {
    if (!value || typeof value !== "object") return "";
    return value[CONTROL_KEY] || "";
}

function closedError(url) {
    return new Error(`Remote namespace import closed before it was ready: ${url}`);
}

/**
 * Owns one WebSocket-to-MessagePort bridge used by a remote namespace import.
 *
 * `port` resolves only after the socket opens. `close()` is idempotent and
 * resolves after both the WebSocket and the Wanix port reader have closed.
 */
export class RemoteNamespaceImport {
    constructor(url, options = {}) {
        const WebSocketClass = options.WebSocket || globalThis.WebSocket;
        const MessageChannelClass = options.MessageChannel || globalThis.MessageChannel;
        if (!WebSocketClass || !MessageChannelClass) {
            throw new Error("Remote namespace imports require WebSocket and MessageChannel");
        }

        this.url = url;
        const channel = new MessageChannelClass();
        this._bridge = channel.port1;
        this._remotePort = channel.port2;
        this._socket = new WebSocketClass(url);
        this._socket.binaryType = "arraybuffer";
        this._portDelivered = false;
        this._readerAttached = false;
        this._readerClaimed = false;
        this._portRevoked = false;
        this._closeRequested = false;
        this._closeSent = false;
        this._closeAcknowledged = false;
        this._socketClosed = false;
        this._closedSettled = false;

        this.port = new Promise((resolve, reject) => {
            this._resolvePort = resolve;
            this._rejectPort = reject;
        });
        // A declarative binding may be removed before namespace setup observes
        // the Promise. Mark it handled without changing what later awaiters see.
        this.port.catch(() => {});
        this.opened = this.port.then(() => undefined);
        this.opened.catch(() => {});
        this.closed = new Promise((resolve) => {
            this._resolveClosed = resolve;
        });

        this._bridge.onmessage = (event) => {
            this._handlePortMessage(event.data);
        };
        this._socket.onopen = () => {
            if (this._closeRequested) {
                this._rejectBeforeOpen(closedError(this.url));
                this._closeSocket();
                return;
            }
            this._portDelivered = true;
            const resolvePort = this._resolvePort;
            this._resolvePort = null;
            this._rejectPort = null;
            resolvePort?.(this._remotePort);
        };
        this._socket.onerror = () => {
            if (!this._portDelivered) {
                this._rejectBeforeOpen(
                    new Error(`Remote namespace import failed to open: ${this.url}`),
                );
            }
            this._requestClose();
        };
        this._socket.onclose = () => {
            this._socketClosed = true;
            if (!this._portDelivered) {
                this._rejectBeforeOpen(closedError(this.url));
            } else {
                this._closeDeliveredPort();
            }
            this._finishClose();
        };
        this._socket.onmessage = (event) => {
            this._forwardSocketMessage(event.data);
        };
    }

    get socket() {
        return this._socket;
    }

    close() {
        this._requestClose();
        return this.closed;
    }

    _requestClose() {
        if (!this._closeRequested) {
            this._closeRequested = true;
            if (!this._portDelivered) {
                this._rejectBeforeOpen(closedError(this.url));
            } else {
                this._closeDeliveredPort();
            }
            this._closeSocket();
        }
        this._finishClose();
    }

    _closeSocket() {
        const socket = this._socket;
        const closing = socket.CLOSING ?? 2;
        if (socket.readyState < closing) {
            socket.close();
        } else if (socket.readyState === (socket.CLOSED ?? 3)) {
            this._socketClosed = true;
        }
    }

    _rejectBeforeOpen(error) {
        if (this._portDelivered) return;
        const rejectPort = this._rejectPort;
        this._resolvePort = null;
        this._rejectPort = null;
        rejectPort?.(error);
    }

    _sendClose() {
        if (this._closeSent) return;
        this._closeSent = true;
        this._bridge.postMessage(controlMessage(CONTROL_CLOSE));
    }

    _closeDeliveredPort() {
        if (this._readerClaimed ||
            this._remotePort?.[STATE_KEY] === STATE_CLAIMED) {
            this._readerClaimed = true;
            this._sendClose();
            return;
        }
        this._portRevoked = true;
        if (this._remotePort) {
            this._remotePort[STATE_KEY] = STATE_REVOKED;
        }
    }

    _handlePortMessage(data) {
        switch (controlKind(data)) {
        case CONTROL_ATTACHED:
            this._readerClaimed = true;
            this._readerAttached = true;
            if (this._closeRequested || this._socketClosed) {
                this._sendClose();
            }
            return;
        case CONTROL_CLOSED:
            this._closeAcknowledged = true;
            this._finishClose();
            return;
        default:
            break;
        }

        if (this._closeRequested || this._socketClosed) return;
        if (this._socket.readyState === (this._socket.OPEN ?? 1)) {
            this._socket.send(data);
        }
    }

    async _forwardSocketMessage(data) {
        if (this._closeRequested || this._socketClosed) return;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) {
                buffer = data;
            } else if (ArrayBuffer.isView(data)) {
                buffer = data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                );
            } else if (typeof Blob !== "undefined" && data instanceof Blob) {
                buffer = await data.arrayBuffer();
            } else {
                throw new Error("Remote namespace import received a non-binary message");
            }
            if (!this._closeRequested && !this._socketClosed) {
                this._bridge.postMessage(buffer, [buffer]);
            }
        } catch (_) {
            this._requestClose();
        }
    }

    _finishClose() {
        if (this._closedSettled || !this._socketClosed) return;
        if (this._portDelivered && !this._portRevoked &&
            !this._closeAcknowledged) return;
        this._closedSettled = true;
        const bridge = this._bridge;
        const remotePort = this._remotePort;
        const resolveClosed = this._resolveClosed;
        this._resolvePort = null;
        this._rejectPort = null;
        this._resolveClosed = null;
        this._bridge = null;
        this._remotePort = null;
        bridge.onmessage = null;
        this._socket.onopen = null;
        this._socket.onerror = null;
        this._socket.onclose = null;
        this._socket.onmessage = null;
        bridge.close();
        remotePort.close();
        resolveClosed?.();
    }
}

export const remoteImportControl = Object.freeze({
    key: CONTROL_KEY,
    attached: CONTROL_ATTACHED,
    close: CONTROL_CLOSE,
    closed: CONTROL_CLOSED,
});

export const remoteImportState = Object.freeze({
    key: STATE_KEY,
    claimed: STATE_CLAIMED,
    revoked: STATE_REVOKED,
});
