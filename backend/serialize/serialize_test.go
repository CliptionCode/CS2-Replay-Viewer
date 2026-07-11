package serialize

import (
	"testing"

	"github.com/yourname/cs2-replay-viewer/backend/parser"
)

func TestConvertFramePreservesReloadState(t *testing.T) {
	frame := convertFrame(&parser.PlayerFrame{IsReloading: true})

	if !frame.IsReloading {
		t.Fatal("converted frame should preserve the active reload state")
	}
}
