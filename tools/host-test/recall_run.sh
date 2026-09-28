#!/bin/bash
# Runs recall_questions.txt against one prompt set. Usage: recall_run.sh model.gguf prompts_dir suffix [reps]
# suffix: "" (with notes) or ".nomemory". Prints Q/A blocks tagged with kind for scoring.
M=$1; D=$2; SUF=$3; export REPS=${4:-3}; B=${RECALL_EVAL:-recall_eval}
grep -v '^#' "$(dirname "$0")/recall_questions.txt" | while IFS='|' read -r kind id q; do
  "$B" "$M" "$D/$id$SUF.txt" "$q" 2>/dev/null | sed -n 's/^A: /A: /p' | sed "s/^/[$kind|$id] $q => /"
done
