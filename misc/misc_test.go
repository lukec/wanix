package misc

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type blockingReadWriteCloser struct {
	closed     chan struct{}
	closeCount atomic.Int32
}

func newBlockingReadWriteCloser() *blockingReadWriteCloser {
	return &blockingReadWriteCloser{closed: make(chan struct{})}
}

func (b *blockingReadWriteCloser) Read([]byte) (int, error) {
	<-b.closed
	return 0, io.ErrClosedPipe
}

func (b *blockingReadWriteCloser) Write(p []byte) (int, error) {
	select {
	case <-b.closed:
		return 0, io.ErrClosedPipe
	default:
		return len(p), nil
	}
}

func (b *blockingReadWriteCloser) Close() error {
	if b.closeCount.Add(1) != 1 {
		return errors.New("underlying close called more than once")
	}
	close(b.closed)
	return nil
}

func TestFakeConnCloseIsConcurrentAndUnblocksRead(t *testing.T) {
	rwc := newBlockingReadWriteCloser()
	conn := NewFakeConn(rwc)
	readDone := make(chan error, 1)
	go func() {
		_, err := conn.Read(make([]byte, 1))
		readDone <- err
	}()

	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := conn.Close(); err != nil {
				t.Errorf("Close() error: %v", err)
			}
		}()
	}
	wg.Wait()

	select {
	case err := <-readDone:
		if !errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("Read() error = %v, want io.ErrClosedPipe", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Read remained blocked after Close")
	}
	if got := rwc.closeCount.Load(); got != 1 {
		t.Fatalf("underlying Close called %d times, want 1", got)
	}
}
