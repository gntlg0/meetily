#!/usr/bin/env bash
# Convert bayartsogt/whisper-large-v2-mn-13 (Hugging Face transformers checkpoint)
# to whisper.cpp GGML format and quantize it for Meetily.
#
# Produces:
#   ggml-mn-large-v2-f16.bin   (~3 GB, full precision)
#   ggml-mn-large-v2-q5_0.bin  (~1 GB, recommended)
#
# These names match the WHISPER_MODEL_CATALOG entries in
# frontend/src-tauri/src/config.rs. Copy the outputs into Meetily's models
# directory (macOS: ~/Library/Application Support/com.meetily.ai/models/).
#
# Requirements: python3 (with venv), cmake, git, ~13 GB free disk.
set -euo pipefail

WORK_DIR="${1:-$PWD/mn-model-work}"
HF_REPO="bayartsogt/whisper-large-v2-mn-13"
HF_BASE="https://huggingface.co/${HF_REPO}/resolve/main"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "==> Setting up Python environment"
if [ ! -d venv ]; then
    python3 -m venv venv
    ./venv/bin/pip install --quiet --upgrade pip
    ./venv/bin/pip install --quiet torch transformers numpy
fi

echo "==> Cloning whisper.cpp and openai/whisper (tokenizer/mel assets)"
[ -d whisper.cpp ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
[ -d openai-whisper ] || git clone --depth 1 https://github.com/openai/whisper.git openai-whisper

echo "==> Building whisper.cpp quantize tool"
cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build whisper.cpp/build --config Release --target whisper-quantize whisper-cli -j > /dev/null

echo "==> Downloading ${HF_REPO} (~6 GB)"
mkdir -p hf-model
for f in config.json added_tokens.json merges.txt normalizer.json \
         preprocessor_config.json special_tokens_map.json tokenizer_config.json vocab.json; do
    [ -f "hf-model/$f" ] || curl -sL -o "hf-model/$f" "$HF_BASE/$f"
done
if [ ! -f hf-model/pytorch_model.bin ]; then
    curl -L --retry 3 -C - -o hf-model/pytorch_model.bin "$HF_BASE/pytorch_model.bin"
fi

echo "==> Converting to GGML f16"
mkdir -p out
./venv/bin/python whisper.cpp/models/convert-h5-to-ggml.py hf-model openai-whisper out
mv out/ggml-model.bin ggml-mn-large-v2-f16.bin

echo "==> Quantizing to Q5_0"
./whisper.cpp/build/bin/whisper-quantize ggml-mn-large-v2-f16.bin ggml-mn-large-v2-q5_0.bin q5_0

echo "==> Done"
ls -lh ggml-mn-large-v2-*.bin
echo
echo "Sanity check example:"
echo "  ./whisper.cpp/build/bin/whisper-cli -m ggml-mn-large-v2-q5_0.bin -l mn -f your_16k_mono.wav"
echo
echo "Install into Meetily (macOS):"
echo "  cp ggml-mn-large-v2-*.bin \"\$HOME/Library/Application Support/com.meetily.ai/models/\""
