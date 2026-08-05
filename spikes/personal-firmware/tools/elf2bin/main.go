// Command elf2bin turns an ESP8266 Arduino bootloader and application ELF into
// the single flash image expected by ESP Web Tools.
package main

import (
	"debug/elf"
	"encoding/binary"
	"flag"
	"fmt"
	"os"
)

const (
	crcSizeOffset  = 4088
	crcValueOffset = 4092
)

var (
	ebootPath = flag.String("eboot", "", "path to eboot.elf")
	appPath   = flag.String("app", "", "path to firmware.elf")
	outPath   = flag.String("out", "", "path to firmware.bin")
)

func main() {
	flag.Parse()
	if *ebootPath == "" || *appPath == "" || *outPath == "" {
		flag.Usage()
		os.Exit(2)
	}

	image, err := buildImage(*ebootPath, *appPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, image, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func buildImage(ebootPath, appPath string) ([]byte, error) {
	eboot, err := elf.Open(ebootPath)
	if err != nil {
		return nil, fmt.Errorf("open bootloader: %w", err)
	}
	defer eboot.Close()

	app, err := elf.Open(appPath)
	if err != nil {
		return nil, fmt.Errorf("open application: %w", err)
	}
	defer app.Close()

	image, err := appendELF(nil, eboot, []string{".text"})
	if err != nil {
		return nil, fmt.Errorf("encode bootloader: %w", err)
	}
	if len(image) > 4096 {
		return nil, fmt.Errorf("bootloader image is %d bytes; maximum is 4096", len(image))
	}
	for len(image) < 4096 {
		image = append(image, 0xaa)
	}

	image, err = appendELF(image, app, []string{
		".irom0.text", ".text", ".text1", ".data", ".rodata",
	})
	if err != nil {
		return nil, fmt.Errorf("encode application: %w", err)
	}
	if len(image) < crcValueOffset+4 {
		return nil, fmt.Errorf("image is too small for the ESP8266 CRC header")
	}

	binary.LittleEndian.PutUint32(image[crcSizeOffset:], 0)
	binary.LittleEndian.PutUint32(image[crcValueOffset:], 0)
	crc := crc8266(image)
	binary.LittleEndian.PutUint32(image[crcSizeOffset:], uint32(len(image)))
	binary.LittleEndian.PutUint32(image[crcValueOffset:], crc)
	return image, nil
}

func appendELF(image []byte, file *elf.File, sectionNames []string) ([]byte, error) {
	start := len(image)
	// dio, 40 MHz, 16 MiB. These match the d1_mini_pro PlatformIO target.
	image = append(image, 0xe9, byte(len(sectionNames)), 2, 0x90)
	image = binary.LittleEndian.AppendUint32(image, uint32(file.Entry))
	checksum := byte(0xef)

	for _, name := range sectionNames {
		section := file.Section(name)
		if section == nil {
			return nil, fmt.Errorf("section %s not found", name)
		}
		data, err := section.Data()
		if err != nil {
			return nil, fmt.Errorf("read section %s: %w", name, err)
		}
		image = binary.LittleEndian.AppendUint32(image, uint32(section.Addr))
		image = binary.LittleEndian.AppendUint32(image, uint32(len(data)))
		image = append(image, data...)
		for _, value := range data {
			checksum ^= value
		}
	}

	for (len(image)-start+1)%16 != 0 {
		image = append(image, 0)
	}
	image = append(image, checksum)
	return image, nil
}

func crc8266(data []byte) uint32 {
	crc := uint32(0xffffffff)
	for _, value := range data {
		for mask := byte(0x80); mask != 0; mask >>= 1 {
			bit := crc & 0x80000000
			if value&mask != 0 {
				bit ^= 0x80000000
			}
			crc <<= 1
			if bit != 0 {
				crc ^= 0x04c11db7
			}
		}
	}
	return crc
}
