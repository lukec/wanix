package main

import "testing"

func TestCRC8266(t *testing.T) {
	const want = uint32(0x665cc778)
	if got := crc8266([]byte("Wanix")); got != want {
		t.Fatalf("crc8266(Wanix) = %#08x, want %#08x", got, want)
	}
}
