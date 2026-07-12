#!/usr/bin/env python3
"""One-off script: flattens the CrowdAnki deck JSON into docs/data/deck.json
and copies the reference markdown notes into docs/data/reference/.

Run manually whenever AWS_CCP_Cert/AWS_CCP_Cert.json or the reference notes
change. Not run at app request time - the deployed app just fetches the
pre-flattened output.
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DECK = ROOT / "AWS_CCP_Cert" / "AWS_CCP_Cert.json"
SRC_REFERENCE = ROOT / "AWS-Certified-Cloud-Practitioner-Notes" / "sections"
OUT_DIR = ROOT / "docs" / "data"

CHOICE_SPLIT_RE = re.compile(r"<br\s*/?>(?=[A-F]\. )")
ANSWER_LETTERS_RE = re.compile(r"Correct answers?:\s*([A-F](?:,\s*[A-F])*)")


def collect_notes(node, deck_name=None):
    """Walk the CrowdAnki tree, returning (note, deck_name) pairs.

    Notes live directly under whichever deck node they belong to; deck_name
    is taken from the nearest ancestor (top-level deck notes get its own name).
    """
    name = node.get("name", deck_name)
    out = [(n, name) for n in node.get("notes", [])]
    for child in node.get("children", []):
        out.extend(collect_notes(child, name))
    return out


def parse_mcq(front, back):
    parts = CHOICE_SPLIT_RE.split(front)
    question = re.sub(r"(<br\s*/?>)+$", "", parts[0]).strip()
    choices = []
    for part in parts[1:]:
        letter, text = part.split(". ", 1)
        choices.append({"letter": letter.strip(), "text": text.strip()})

    match = ANSWER_LETTERS_RE.search(back)
    correct = [l.strip() for l in match.group(1).split(",")] if match else []

    explanation_start = back.find("<br><br>")
    explanation = back[explanation_start + 8:].strip() if explanation_start != -1 else ""

    return {
        "question": question,
        "choices": choices,
        "correct": correct,
        "explanation": explanation,
    }


def build_deck():
    with open(SRC_DECK) as f:
        root = json.load(f)

    note_models = {m["crowdanki_uuid"]: m["name"] for m in root["note_models"]}
    cards = []

    for note, deck_name in collect_notes(root):
        model_name = note_models[note["note_model_uuid"]]
        fields = note["fields"]

        if model_name == "Cloze":
            card = {
                "id": note["guid"],
                "type": "cloze",
                "deck": deck_name,
                "tags": note["tags"],
                "text": fields[0],
                "extra": fields[1],
            }
        elif model_name == "AWS MCQ":
            mcq = parse_mcq(fields[0], fields[1])
            card = {
                "id": note["guid"],
                "type": "mcq",
                "deck": deck_name,
                "tags": note["tags"],
                **mcq,
            }
        else:
            continue

        cards.append(card)

    return cards


def extract_title(md_file):
    with open(md_file) as f:
        first_line = f.readline().strip()
    match = re.match(r"^#\s+(.*)$", first_line)
    return match.group(1).strip() if match else md_file.stem.replace("_", " ").title()


def build_reference():
    ref_out = OUT_DIR / "reference"
    ref_out.mkdir(parents=True, exist_ok=True)
    files = []
    for md_file in sorted(SRC_REFERENCE.glob("*.md")):
        shutil.copy(md_file, ref_out / md_file.name)
        files.append({"file": md_file.name, "title": extract_title(md_file)})
    return files


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    cards = build_deck()
    with open(OUT_DIR / "deck.json", "w") as f:
        json.dump(cards, f, indent=2)
    print(f"Wrote {len(cards)} cards to {OUT_DIR / 'deck.json'}")

    files = build_reference()
    with open(OUT_DIR / "reference-index.json", "w") as f:
        json.dump(files, f, indent=2)
    print(f"Copied {len(files)} reference files to {OUT_DIR / 'reference'}")


if __name__ == "__main__":
    main()
