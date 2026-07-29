//go:build js && wasm

package main

import (
	"errors"
	"io"
	"syscall/js"
	"testing"
	"time"
)

func TestP9PortReadWriterCloseSignalUnblocksReadAndAcknowledges(t *testing.T) {
	channel := js.Global().Get("MessageChannel").New()
	control := make(chan string, 2)
	onMessage := js.FuncOf(func(this js.Value, args []js.Value) any {
		data := args[0].Get("data")
		if data.Type() == js.TypeObject {
			control <- data.Get(remoteImportControlKey).String()
		}
		return nil
	})
	defer onMessage.Release()
	channel.Get("port1").Set("onmessage", onMessage)

	rw := NewP9PortReadWriter(channel.Get("port2"))
	if got := channel.Get("port2").Get(remoteImportStateKey).String(); got != remoteImportStateClaimed {
		t.Fatalf("port state = %q, want %q", got, remoteImportStateClaimed)
	}
	readDone := make(chan error, 1)
	go func() {
		_, err := rw.Read(make([]byte, 1))
		readDone <- err
	}()

	if got := receiveControl(t, control); got != remoteImportControlAttached {
		t.Fatalf("first control message = %q, want %q", got, remoteImportControlAttached)
	}
	channel.Get("port1").Call("postMessage", map[string]any{
		remoteImportControlKey: remoteImportControlClose,
	})
	if got := receiveControl(t, control); got != remoteImportControlClosed {
		t.Fatalf("close control message = %q, want %q", got, remoteImportControlClosed)
	}

	select {
	case err := <-readDone:
		if !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("Read() error = %v, want EOF or io.ErrClosedPipe", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Read remained blocked after remote close signal")
	}
	if _, err := rw.Write([]byte{1}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("Write() error = %v, want io.ErrClosedPipe", err)
	}
	if err := rw.Close(); err != nil {
		t.Fatalf("second Close() error: %v", err)
	}
}

func TestP9PortReadWriterRevokedBeforeClaimIsImmediatelyClosed(t *testing.T) {
	for i := 0; i < 100; i++ {
		channel := js.Global().Get("MessageChannel").New()
		port := channel.Get("port2")
		port.Set(remoteImportStateKey, remoteImportStateRevoked)

		rw := NewP9PortReadWriter(port)
		if got := port.Get(remoteImportStateKey).String(); got != remoteImportStateRevoked {
			t.Fatalf("iteration %d: port state = %q, want %q", i, got, remoteImportStateRevoked)
		}
		if port.Get("onmessage").Type() != js.TypeNull &&
			port.Get("onmessage").Type() != js.TypeUndefined {
			t.Fatalf("iteration %d: revoked port installed an onmessage callback", i)
		}
		if _, err := rw.Read(make([]byte, 1)); !errors.Is(err, io.EOF) &&
			!errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("iteration %d: Read() error = %v, want EOF or io.ErrClosedPipe", i, err)
		}
		if _, err := rw.Write([]byte{1}); !errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("iteration %d: Write() error = %v, want io.ErrClosedPipe", i, err)
		}
		if err := rw.Close(); err != nil {
			t.Fatalf("iteration %d: Close() error: %v", i, err)
		}
	}
}

func TestP9PortReadWriterClaimWinsBeforeAttachedMessage(t *testing.T) {
	for i := 0; i < 100; i++ {
		channel := js.Global().Get("MessageChannel").New()
		control := make(chan string, 2)
		onMessage := js.FuncOf(func(this js.Value, args []js.Value) any {
			data := args[0].Get("data")
			if data.Type() == js.TypeObject {
				control <- data.Get(remoteImportControlKey).String()
			}
			return nil
		})
		channel.Get("port1").Set("onmessage", onMessage)

		port := channel.Get("port2")
		rw := NewP9PortReadWriter(port)
		if got := port.Get(remoteImportStateKey).String(); got != remoteImportStateClaimed {
			t.Fatalf("iteration %d: port state = %q, want %q", i, got, remoteImportStateClaimed)
		}
		if got := receiveControl(t, control); got != remoteImportControlAttached {
			t.Fatalf("iteration %d: first control = %q, want %q", i, got, remoteImportControlAttached)
		}
		channel.Get("port1").Call("postMessage", map[string]any{
			remoteImportControlKey: remoteImportControlClose,
		})
		if got := receiveControl(t, control); got != remoteImportControlClosed {
			t.Fatalf("iteration %d: close control = %q, want %q", i, got, remoteImportControlClosed)
		}
		if err := rw.Close(); err != nil {
			t.Fatalf("iteration %d: second Close() error: %v", i, err)
		}
		onMessage.Release()
	}
}

func receiveControl(t *testing.T, control <-chan string) string {
	t.Helper()
	select {
	case value := <-control:
		return value
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for import control message")
		return ""
	}
}
