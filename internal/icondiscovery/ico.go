package icondiscovery

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
)

// isICO recognizes the ICONDIR header: reserved 0, type 1, at least one entry.
func isICO(data []byte) bool {
	return len(data) >= 6 && binary.LittleEndian.Uint16(data[0:]) == 0 &&
		binary.LittleEndian.Uint16(data[2:]) == 1 && binary.LittleEndian.Uint16(data[4:]) > 0
}

// decodeICO returns the largest image in an ICO file. Entries may embed a PNG
// or a bottom-up DIB; 32-bit (alpha), 24-bit and 8-bit palette DIBs are
// supported, which covers virtually all favicons.
func decodeICO(data []byte) (image.Image, error) {
	count := int(binary.LittleEndian.Uint16(data[4:]))
	if count > 64 || len(data) < 6+16*count {
		return nil, errors.New("malformed icon directory")
	}
	var best image.Image
	for i := 0; i < count; i++ {
		entry := data[6+16*i:]
		size := binary.LittleEndian.Uint32(entry[8:])
		offset := binary.LittleEndian.Uint32(entry[12:])
		if uint64(offset)+uint64(size) > uint64(len(data)) || size < 16 {
			continue
		}
		img, e := decodeICOEntry(data[offset : offset+size])
		if e != nil {
			continue
		}
		if best == nil || side(img) > side(best) {
			best = img
		}
	}
	if best == nil {
		return nil, errors.New("no decodable icon entry")
	}
	return best, nil
}

func decodeICOEntry(entry []byte) (image.Image, error) {
	if bytes.HasPrefix(entry, []byte("\x89PNG\r\n\x1a\n")) {
		cfg, e := png.DecodeConfig(bytes.NewReader(entry))
		if e != nil || !inBounds(cfg.Width, cfg.Height) {
			return nil, errors.New("invalid embedded PNG")
		}
		return png.Decode(bytes.NewReader(entry))
	}
	return decodeDIB(entry)
}

func decodeDIB(dib []byte) (image.Image, error) {
	if len(dib) < 40 {
		return nil, errors.New("short DIB header")
	}
	headerSize := int(binary.LittleEndian.Uint32(dib[0:]))
	width := int(int32(binary.LittleEndian.Uint32(dib[4:])))
	// The stored height covers the color bitmap and the AND mask.
	height := int(int32(binary.LittleEndian.Uint32(dib[8:]))) / 2
	bpp := int(binary.LittleEndian.Uint16(dib[14:]))
	compression := binary.LittleEndian.Uint32(dib[16:])
	colorsUsed := int(binary.LittleEndian.Uint32(dib[32:]))
	if headerSize < 40 || headerSize > len(dib) || compression != 0 || !inBounds(width, height) {
		return nil, errors.New("unsupported DIB")
	}
	var palette []color.NRGBA
	pixels := headerSize
	if bpp == 8 {
		if colorsUsed == 0 || colorsUsed > 256 {
			colorsUsed = 256
		}
		if pixels+4*colorsUsed > len(dib) {
			return nil, errors.New("short palette")
		}
		for i := 0; i < colorsUsed; i++ {
			p := dib[pixels+4*i:]
			palette = append(palette, color.NRGBA{R: p[2], G: p[1], B: p[0], A: 255})
		}
		pixels += 4 * colorsUsed
	} else if bpp != 24 && bpp != 32 {
		return nil, errors.New("unsupported bit depth")
	}
	stride := (width*bpp + 31) / 32 * 4
	maskStride := (width + 31) / 32 * 4
	if pixels+stride*height > len(dib) {
		return nil, errors.New("short pixel data")
	}
	mask := pixels + stride*height
	hasMask := mask+maskStride*height <= len(dib)
	// 32-bit entries carry alpha; older ones leave it zero and rely on the mask.
	useMask := hasMask && (bpp != 32 || !anyAlpha(dib[pixels:mask], width, height, stride))
	out := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		row := dib[pixels+(height-1-y)*stride:]
		for x := 0; x < width; x++ {
			var c color.NRGBA
			switch bpp {
			case 32:
				c = color.NRGBA{R: row[4*x+2], G: row[4*x+1], B: row[4*x], A: row[4*x+3]}
				if useMask {
					c.A = 255
				}
			case 24:
				c = color.NRGBA{R: row[3*x+2], G: row[3*x+1], B: row[3*x], A: 255}
			case 8:
				index := int(row[x])
				if index >= len(palette) {
					return nil, errors.New("palette index out of range")
				}
				c = palette[index]
			}
			if useMask {
				bits := dib[mask+(height-1-y)*maskStride:]
				if bits[x/8]&(0x80>>(x%8)) != 0 {
					c.A = 0
				}
			}
			out.SetNRGBA(x, y, c)
		}
	}
	return out, nil
}

func anyAlpha(pixels []byte, width, height, stride int) bool {
	for y := 0; y < height; y++ {
		row := pixels[y*stride:]
		for x := 0; x < width; x++ {
			if row[4*x+3] != 0 {
				return true
			}
		}
	}
	return false
}
