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
SRC_NOTES = ROOT / "AWS-Certified-Cloud-Practitioner-Notes"
SRC_REFERENCE = SRC_NOTES / "sections"
SRC_STUDY_GUIDE = SRC_NOTES / "study-guide.md"
OUT_DIR = ROOT / "docs" / "data"

CHOICE_SPLIT_RE = re.compile(r"<br\s*/?>(?=[A-F]\. )")
ANSWER_LETTERS_RE = re.compile(r"Correct answers?:\s*([A-F](?:,\s*[A-F])*)")

# Ordered (slug, title, domain) for every reference topic except study-guide.md
# (the curriculum's own meta-document, not a classification target). Order is
# curated for a sensible learning progression within each domain, not
# alphabetical. domain is 1-4 matching the official CLF-C01 exam guide:
# 1 Cloud Concepts, 2 Security and Compliance, 3 Technology, 4 Billing and Pricing.
DOMAIN_TITLES = {
    1: "Cloud Concepts",
    2: "Security and Compliance",
    3: "Technology",
    4: "Billing and Pricing",
}

TOPIC_ORDER = [
    ("cloud_computing", "Cloud Computing", 1),
    ("architecting_and_ecosystem", "AWS Architecting & Ecosystem", 1),
    ("iam", "IAM", 2),
    ("advanced_identity", "Advanced Identity", 2),
    ("security_compliance", "Security & Compliance", 2),
    ("global_infrastructure", "Global Infrastructure", 3),
    ("ec2", "EC2: Virtual Machines", 3),
    ("other_compute", "Other Compute", 3),
    ("ec2_storage", "EC2 Instance Storage", 3),
    ("elb_asg", "Elastic Load Balancing & Auto Scaling Groups", 3),
    ("vpc", "VPC", 3),
    ("s3", "Amazon S3", 3),
    ("databases", "Databases & Analytics", 3),
    ("cloud_integration", "Cloud Integration", 3),
    ("machine_learning", "Machine Learning", 3),
    ("cloud_monitoring", "Cloud Monitoring", 3),
    ("deploying", "Deploying and Managing Infrastructure at Scale", 3),
    ("other_aws_services", "Other AWS Services", 3),
    ("account_management_billing_support", "Account Management, Billing & Support", 4),
]

FALLBACK_TOPIC = "other_aws_services"
FALLBACK_DOMAIN = dict((slug, domain) for slug, _, domain in TOPIC_ORDER)[FALLBACK_TOPIC]

# Words too generic in this AWS-only corpus to carry classification signal on
# their own (they'd match almost every card). Full multi-word phrases mined
# from headings are unaffected by this list - only single-word keywords are
# filtered against it.
GENERIC_WORDS = {
    "aws", "amazon", "cloud", "service", "services", "data", "using", "used",
    "use", "also", "which", "about", "provides", "provide", "allows", "allow",
    "includes", "include", "level", "based", "time", "user", "users",
    "account", "accounts", "with", "from", "your", "that", "this", "into",
    "these", "those", "other", "more", "most", "such", "only", "same",
    "over", "under", "between", "across", "within", "without", "different",
    "example", "examples", "type", "types", "when", "where", "what", "why",
    # Incidental fragments of multi-word headings/product names (e.g. "center"
    # from "IAM Identity Center", "volume" from "EBS Volumes") that are too
    # generic on their own and cause false-positive matches on unrelated cards.
    "center", "centre", "single", "login", "store", "stores", "management",
    "manage", "create", "creating", "created", "system", "systems",
    "application", "applications", "database", "databases", "instance",
    "instances", "resource", "resources", "access", "information", "general",
    "basic", "common", "various", "multiple", "primary", "secondary",
    "volume", "volumes", "group", "groups", "control", "controls",
}

HEADING_STOPWORDS_RE = re.compile(
    r"\b(what is|what's|why|define|overview|summary|introduction|section|"
    r"benefits of|example of|example usage|example commands|key features of|"
    r"common|settings|guidelines|best practices|use cases?|comparison|"
    r"versus|vs\.?|general|guiding principles|features)\b",
    re.IGNORECASE,
)


def clean_phrase(text):
    text = re.sub(r"[*_`]", "", text)
    text = HEADING_STOPWORDS_RE.sub(" ", text)
    text = re.sub(r"[^a-zA-Z0-9&\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def title_keywords(title):
    out = []
    for paren in re.findall(r"\(([^)]+)\)", title):
        phrase = clean_phrase(paren)
        if phrase:
            out.append((phrase, 4))
    base = clean_phrase(re.sub(r"\([^)]*\)", " ", title))
    if base:
        out.append((base, 4))
    return out


def mine_heading_keywords(md_file):
    with open(md_file) as f:
        content = f.read()

    phrase_weights = {}

    def bump(phrase, weight):
        phrase = phrase.strip().lower()
        if len(phrase) >= 3:
            phrase_weights[phrase] = max(phrase_weights.get(phrase, 0), weight)

    for heading in re.findall(r"^#{1,4}\s+(.*)$", content, re.MULTILINE):
        for paren in re.findall(r"\(([^)]+)\)", heading):
            bump(clean_phrase(paren), 2)
        phrase = clean_phrase(re.sub(r"\([^)]*\)", " ", heading))
        if not phrase:
            continue
        bump(phrase, 2)
        for word in phrase.split():
            if len(word) >= 4 and word not in GENERIC_WORDS:
                bump(word, 1)

    return list(phrase_weights.items())


def build_topic_keywords():
    mined = []
    for slug, title, domain in TOPIC_ORDER:
        md_file = SRC_REFERENCE / f"{slug}.md"
        keywords = title_keywords(title) + mine_heading_keywords(md_file)
        mined.append((slug, domain, keywords))

    # Some reference files re-cover ground that has its own dedicated topic
    # (e.g. cloud_computing.md has a "Shared Responsibility Model" heading
    # that duplicates security_compliance.md's). An identical heading-derived
    # phrase mined from more than one topic is ambiguous by definition -
    # drop it everywhere rather than let it distort scoring. Title keywords
    # (weight 4) are exempt: topic titles shouldn't collide in practice, and
    # if they did, that's a real signal worth keeping.
    phrase_topic_counts = {}
    for slug, domain, keywords in mined:
        for phrase, weight in keywords:
            if weight < 4:
                phrase_topic_counts[phrase] = phrase_topic_counts.get(phrase, set()) | {slug}

    ambiguous = {p for p, topics in phrase_topic_counts.items() if len(topics) > 1}

    topic_keywords = []
    for slug, domain, keywords in mined:
        deduped = [(p, w) for p, w in keywords if w >= 4 or p not in ambiguous]
        topic_keywords.append((slug, domain, deduped))
    return topic_keywords


def clean_card_text(html):
    text = re.sub(r"\{\{c\d+::(.*?)(?:::.*?)?\}\}", r"\1", html)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&[a-zA-Z#0-9]+;", " ", text)
    return text.lower()


def classify(text, topic_keywords):
    cleaned = clean_card_text(text)
    best_slug, best_domain = FALLBACK_TOPIC, FALLBACK_DOMAIN
    best_rank = (0, 0)  # (total score, strongest single match) - specificity breaks ties

    for slug, domain, keywords in topic_keywords:
        hits = [weight for phrase, weight in keywords if phrase in cleaned]
        if not hits:
            continue
        rank = (sum(hits), max(hits))
        if rank > best_rank:
            best_slug, best_domain, best_rank = slug, domain, rank

    return best_slug, best_domain


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


def build_deck(topic_keywords):
    with open(SRC_DECK) as f:
        root = json.load(f)

    note_models = {m["crowdanki_uuid"]: m["name"] for m in root["note_models"]}
    cards = []

    for note, deck_name in collect_notes(root):
        model_name = note_models[note["note_model_uuid"]]
        fields = note["fields"]

        if model_name == "Cloze":
            classify_text = fields[0] + " " + fields[1]
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
            classify_text = " ".join(
                [mcq["question"]] + [c["text"] for c in mcq["choices"]] + [mcq["explanation"]]
            )
            card = {
                "id": note["guid"],
                "type": "mcq",
                "deck": deck_name,
                "tags": note["tags"],
                **mcq,
            }
        else:
            continue

        topic, domain = classify(classify_text, topic_keywords)
        card["topic"] = topic
        card["domain"] = domain
        cards.append(card)

    return cards


def build_curriculum(cards):
    counts = {}
    for card in cards:
        counts[card["topic"]] = counts.get(card["topic"], 0) + 1

    domains = []
    for domain_num in sorted(DOMAIN_TITLES):
        topics = [
            {"slug": slug, "title": title, "count": counts.get(slug, 0)}
            for slug, title, d in TOPIC_ORDER
            if d == domain_num
        ]
        domains.append({
            "domain": domain_num,
            "title": DOMAIN_TITLES[domain_num],
            "count": sum(t["count"] for t in topics),
            "topics": topics,
        })
    return domains


def extract_title(md_file):
    with open(md_file) as f:
        first_line = f.readline().strip()
    match = re.match(r"^#\s+(.*)$", first_line)
    return match.group(1).strip() if match else md_file.stem.replace("_", " ").title()


def build_reference():
    ref_out = OUT_DIR / "reference"
    ref_out.mkdir(parents=True, exist_ok=True)
    files = []

    shutil.copy(SRC_STUDY_GUIDE, ref_out / SRC_STUDY_GUIDE.name)
    files.append({"file": SRC_STUDY_GUIDE.name, "title": extract_title(SRC_STUDY_GUIDE)})

    for md_file in sorted(SRC_REFERENCE.glob("*.md")):
        shutil.copy(md_file, ref_out / md_file.name)
        files.append({"file": md_file.name, "title": extract_title(md_file)})
    return files


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    topic_keywords = build_topic_keywords()
    cards = build_deck(topic_keywords)
    with open(OUT_DIR / "deck.json", "w") as f:
        json.dump(cards, f, indent=2)
    print(f"Wrote {len(cards)} cards to {OUT_DIR / 'deck.json'}")

    curriculum = build_curriculum(cards)
    with open(OUT_DIR / "curriculum.json", "w") as f:
        json.dump(curriculum, f, indent=2)
    print(f"Wrote curriculum.json ({sum(d['count'] for d in curriculum)} classified cards across {len(curriculum)} domains)")

    files = build_reference()
    with open(OUT_DIR / "reference-index.json", "w") as f:
        json.dump(files, f, indent=2)
    print(f"Copied {len(files)} reference files to {OUT_DIR / 'reference'}")


if __name__ == "__main__":
    main()
