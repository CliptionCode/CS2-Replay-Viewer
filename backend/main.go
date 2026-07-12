package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/yourname/cs2-replay-viewer/backend/parser"
	"github.com/yourname/cs2-replay-viewer/backend/serialize"
)

type ParseRequest struct {
	Path string `json:"path"`
}

type ParseResponse struct {
	Success bool   `json:"success"`
	Data    string `json:"data,omitempty"`
	Path    string `json:"path,omitempty"`
	Error   string `json:"error,omitempty"`
}

func main() {
	var path string
	var outputPath string

	if len(os.Args) > 1 {
		path = os.Args[1]
		if len(os.Args) > 3 && os.Args[2] == "--output" {
			outputPath = os.Args[3]
		}
	} else {
		data, err := io.ReadAll(os.Stdin)
		if err != nil && err != io.EOF {
			outputError(fmt.Sprintf("Failed to read stdin: %v", err))
			return
		}

		if len(data) == 0 {
			outputError("Usage: cs2-parser <demo.dem> | echo '{\"path\": \"demo.dem\"}' | cs2-parser")
			return
		}

		var req ParseRequest
		if err := json.Unmarshal(data, &req); err != nil {
			outputError(fmt.Sprintf("Failed to parse request: %v", err))
			return
		}
		path = req.Path
	}

	if path == "" {
		outputError("No path provided")
		return
	}

	replay, err := parser.ParseFile(path)
	if err != nil {
		outputError(fmt.Sprintf("Failed to parse demo: %v", err))
		return
	}

	pbBytes, err := serialize.ReplayDataToProto(replay)
	if err != nil {
		outputError(fmt.Sprintf("Failed to serialize: %v", err))
		return
	}
	if outputPath != "" {
		if err := os.WriteFile(outputPath, pbBytes, 0600); err != nil {
			outputError(fmt.Sprintf("Failed to write protobuf output: %v", err))
			return
		}
		json.NewEncoder(os.Stdout).Encode(ParseResponse{Success: true, Path: outputPath})
		return
	}

	b64 := base64.StdEncoding.EncodeToString(pbBytes)

	resp := ParseResponse{
		Success: true,
		Data:    b64,
	}
	json.NewEncoder(os.Stdout).Encode(resp)
}

func outputError(msg string) {
	resp := ParseResponse{
		Success: false,
		Error:   msg,
	}
	json.NewEncoder(os.Stdout).Encode(resp)
	os.Exit(1)
}
