import assert from "node:assert/strict";
import test from "node:test";

import {
    RemoteNamespaceImport,
    remoteImportControl,
    remoteImportState,
} from "./remote-import.js";

class FakePort {
    constructor() {
        this.peer = null;
        this.closed = false;
        this.queue = [];
        this._onmessage = null;
    }

    set onmessage(handler) {
        this._onmessage = handler;
        this._flush();
    }

    get onmessage() {
        return this._onmessage;
    }

    postMessage(data) {
        if (!this.closed && this.peer && !this.peer.closed) {
            this.peer.queue.push(data);
            this.peer._flush();
        }
    }

    close() {
        this.closed = true;
    }

    _flush() {
        if (!this._onmessage) return;
        while (this.queue.length > 0) {
            const data = this.queue.shift();
            queueMicrotask(() => {
                if (!this.closed && this._onmessage) {
                    this._onmessage({ data });
                }
            });
        }
    }
}

class FakeMessageChannel {
    constructor() {
        this.port1 = new FakePort();
        this.port2 = new FakePort();
        this.port1.peer = this.port2;
        this.port2.peer = this.port1;
    }
}

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        this.url = url;
        this.CONNECTING = FakeWebSocket.CONNECTING;
        this.OPEN = FakeWebSocket.OPEN;
        this.CLOSING = FakeWebSocket.CLOSING;
        this.CLOSED = FakeWebSocket.CLOSED;
        this.readyState = this.CONNECTING;
        this.sent = [];
        FakeWebSocket.instances.push(this);
    }

    open() {
        this.readyState = this.OPEN;
        this.onopen?.();
    }

    send(data) {
        if (this.readyState !== this.OPEN) {
            throw new Error("send on closed socket");
        }
        this.sent.push(data);
    }

    close() {
        if (this.readyState >= this.CLOSING) return;
        this.readyState = this.CLOSING;
        queueMicrotask(() => {
            this.readyState = this.CLOSED;
            this.onclose?.();
        });
    }

    failOpen() {
        this.onerror?.();
    }

    remoteClose() {
        this.readyState = this.CLOSED;
        this.onclose?.();
    }

    receive(data) {
        this.onmessage?.({ data });
    }
}

function createImport() {
    FakeWebSocket.instances = [];
    const remote = new RemoteNamespaceImport("ws://example.test/namespace", {
        WebSocket: FakeWebSocket,
        MessageChannel: FakeMessageChannel,
    });
    return { remote, socket: FakeWebSocket.instances[0] };
}

function claimReader(port) {
    if (port[remoteImportState.key] === remoteImportState.revoked) {
        return false;
    }
    port[remoteImportState.key] = remoteImportState.claimed;
    port.onmessage = (event) => {
        if (event.data?.[remoteImportControl.key] === remoteImportControl.close) {
            port.postMessage({
                [remoteImportControl.key]: remoteImportControl.closed,
            });
        }
    };
    port.postMessage({
        [remoteImportControl.key]: remoteImportControl.attached,
    });
    return true;
}

async function settles(promise) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Promise did not settle")), 250);
        }),
    ]);
}

function assertHandlersReleased(remote, socket, bridge) {
    assert.equal(bridge.onmessage, null);
    assert.equal(socket.onopen, null);
    assert.equal(socket.onerror, null);
    assert.equal(socket.onclose, null);
    assert.equal(socket.onmessage, null);
    assert.equal(remote._resolvePort, null);
    assert.equal(remote._rejectPort, null);
    assert.equal(remote._resolveClosed, null);
    assert.equal(remote._bridge, null);
    assert.equal(remote._remotePort, null);
}

test("close before open rejects readiness and closes idempotently", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    const firstClose = remote.close();
    const secondClose = remote.close();

    assert.equal(firstClose, secondClose);
    await assert.rejects(remote.port, /closed before it was ready/);
    await settles(firstClose);
    assertHandlersReleased(remote, socket, bridge);
});

test("socket open failure rejects readiness and closes", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    socket.failOpen();

    await assert.rejects(remote.opened, /failed to open/);
    await settles(remote.closed);
    assertHandlersReleased(remote, socket, bridge);
});

test("open then close before reader claim revokes and settles locally", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    socket.open();
    const port = await remote.port;

    await settles(remote.close());

    assert.equal(port[remoteImportState.key], remoteImportState.revoked);
    assert.equal(claimReader(port), false);
    assertHandlersReleased(remote, socket, bridge);
});

test("reader claim racing close wins before callback installation", async () => {
    for (let index = 0; index < 100; index += 1) {
        const { remote, socket } = createImport();
        const bridge = remote._bridge;
        socket.open();
        const port = await remote.port;

        // This assignment is the synchronous claim made by the Go reader
        // before it installs onmessage or posts the typed attached control.
        port[remoteImportState.key] = remoteImportState.claimed;
        const closing = remote.close();
        let closed = false;
        closing.then(() => { closed = true; });
        await Promise.resolve();
        assert.equal(closed, false);

        port.onmessage = (event) => {
            if (event.data?.[remoteImportControl.key] === remoteImportControl.close) {
                port.postMessage({
                    [remoteImportControl.key]: remoteImportControl.closed,
                });
            }
        };
        port.postMessage({
            [remoteImportControl.key]: remoteImportControl.attached,
        });
        await settles(closing);
        assertHandlersReleased(remote, socket, bridge);
    }
});

test("close after attachment waits for socket close and reader acknowledgement", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    socket.open();
    const port = await remote.port;
    assert.equal(claimReader(port), true);
    await Promise.resolve();

    await settles(remote.close());
    assert.equal(socket.readyState, socket.CLOSED);
    assertHandlersReleased(remote, socket, bridge);
});

test("remote close notifies the reader and settles the same close Promise", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    socket.open();
    const port = await remote.port;
    assert.equal(claimReader(port), true);
    await Promise.resolve();

    socket.remoteClose();
    await settles(remote.closed);
    assert.equal(remote.close(), remote.closed);
    assertHandlersReleased(remote, socket, bridge);
});

test("binary messages cross the bridge before close", async () => {
    const { remote, socket } = createImport();
    const bridge = remote._bridge;
    socket.open();
    const port = await remote.port;
    const inbound = [];
    port.onmessage = (event) => {
        if (!event.data?.[remoteImportControl.key]) inbound.push(event.data);
    };
    port[remoteImportState.key] = remoteImportState.claimed;
    port.postMessage({
        [remoteImportControl.key]: remoteImportControl.attached,
    });

    const outgoing = new Uint8Array([1, 2, 3]);
    port.postMessage(outgoing);
    await Promise.resolve();
    assert.deepEqual(socket.sent, [outgoing]);

    socket.receive(new Uint8Array([4, 5, 6]));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual([...new Uint8Array(inbound[0])], [4, 5, 6]);

    port.onmessage = (event) => {
        if (event.data?.[remoteImportControl.key] === remoteImportControl.close) {
            port.postMessage({
                [remoteImportControl.key]: remoteImportControl.closed,
            });
        }
    };
    await settles(remote.close());
    assertHandlersReleased(remote, socket, bridge);
});

test("repeated imports release every bridge and socket handler", async () => {
    for (let index = 0; index < 100; index += 1) {
        const { remote, socket } = createImport();
        const bridge = remote._bridge;
        socket.open();
        const port = await remote.port;
        assert.equal(claimReader(port), true);
        await Promise.resolve();
        const firstClose = remote.close();
        const concurrentClose = remote.close();
        assert.equal(firstClose, concurrentClose);
        await settles(Promise.all([firstClose, concurrentClose]));
        assert.equal(remote.close(), remote.closed);
        assertHandlersReleased(remote, socket, bridge);
    }
});
