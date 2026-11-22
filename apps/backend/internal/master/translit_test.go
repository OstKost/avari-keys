package master

import (
	"testing"
)

func TestTransliterate(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Привет", "Privet"},
		{"Айфон", "Ayfon"},
		{"Рабочий ноутбук", "Rabochiy noutbuk"},
		{"Щука", "Shchuka"},
		{"Подъезд", "Podezd"},
		{"iPhone 15 Pro", "iPhone 15 Pro"},
		{"Тест-Устройство_1", "Test-Ustroystvo_1"},
	}

	for _, tc := range tests {
		actual := Transliterate(tc.input)
		if actual != tc.expected {
			t.Errorf("Transliterate(%q) = %q; want %q", tc.input, actual, tc.expected)
		}
	}
}

func TestSanitizeDeviceNameForClient(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Айфон Forve", "Ayfon_Forve"},
		{"Рабочий ПК", "Rabochiy_PK"},
		{"---Тест---", "Test"},
		{"!@#$%^", "device"},
		{"iPhone", "iPhone"},
		{"  Моб 1  ", "Mob_1"},
	}

	for _, tc := range tests {
		actual := SanitizeDeviceNameForClient(tc.input)
		if actual != tc.expected {
			t.Errorf("SanitizeDeviceNameForClient(%q) = %q; want %q", tc.input, actual, tc.expected)
		}
	}
}
