package master

import (
	"strings"
	"unicode"
)

var cyrillicToLatinMap = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "yo",
	'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
	'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
	'ф': "f", 'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "shch",
	'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",

	'А': "A", 'Б': "B", 'В': "V", 'Г': "G", 'Д': "D", 'Е': "E", 'Ё': "Yo",
	'Ж': "Zh", 'З': "Z", 'И': "I", 'Й': "Y", 'К': "K", 'Л': "L", 'М': "M",
	'Н': "N", 'О': "O", 'П': "P", 'Р': "R", 'С': "S", 'Т': "T", 'У': "U",
	'Ф': "F", 'Х': "Kh", 'Ц': "Ts", 'Ч': "Ch", 'Ш': "Sh", 'Щ': "Shch",
	'Ъ': "", 'Ы': "Y", 'Ь': "", 'Э': "E", 'Ю': "Yu", 'Я': "Ya",
}

// Transliterate converts Cyrillic letters to Latin equivalents.
// Non-Cyrillic characters are left as-is.
func Transliterate(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if tr, ok := cyrillicToLatinMap[r]; ok {
			sb.WriteString(tr)
		} else {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// SanitizeDeviceNameForClient creates a safe alphanumeric name suitable for
// node peer identifiers (u{id}_{cleanDevice}).
func SanitizeDeviceNameForClient(s string) string {
	translit := Transliterate(s)
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		if unicode.IsSpace(r) {
			return '_'
		}
		return '_'
	}, translit)

	// Collapse consecutive underscores
	for strings.Contains(clean, "__") {
		clean = strings.ReplaceAll(clean, "__", "_")
	}
	clean = strings.Trim(clean, "_-")
	if clean == "" {
		return "device"
	}
	return clean
}
