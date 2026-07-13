# AWS-CCP-Cert-Anki-Deck
An Anki deck to help with studying for the AWS Certified Cloud Practitioner exam. Mostly based off of content presented in Exampro course [https://www.youtube.com/watch?v=3hLmDS179YE&t=1397s](https://www.youtube.com/watch?v=3hLmDS179YE&t=1397s).

## Repo layout

- **[AWS_CCP_Cert/](AWS_CCP_Cert/)** — the deck in [CrowdAnki](https://github.com/Stvad/CrowdAnki) format. In Anki, install the CrowdAnki add-on and use "Import from disk," pointing it at the `AWS_CCP_Cert/` **folder** (not the bare `.json` file inside it — CrowdAnki's importer expects a folder).
- **[docs/](docs/)** — the same deck as an installable, offline-first web app (see [Study online](#study-online) below). `docs/data/` is generated, not hand-edited.
- **[scripts/](scripts/)** — build scripts that generate `docs/data/`:
  - `build-data.py` flattens `AWS_CCP_Cert/AWS_CCP_Cert.json` into `docs/data/deck.json` and copies the reference notes (see Credits) into `docs/data/reference/`. Re-run it after editing the deck or the source notes.
  - `gen-icons.py` regenerates the PWA icons in `docs/icons/`.
- **`AWS-Certified-Cloud-Practitioner-Notes/`** — a local clone of the reference-notes repo (see Credits), gitignored. It's only needed if you want to re-run `build-data.py` after that repo updates; the app itself doesn't depend on it, since its output is already committed under `docs/data/`.

## Study online

The same deck is also available as an installable, offline-first web app — no Anki install required. Visit the site once while online (it caches itself for offline use afterward), or add it to your phone's home screen:

**https://cyriletornam.github.io/AWS-CCP-Cert-Anki-Deck/**

It includes spaced-repetition flashcards (cloze + multiple choice) and a browsable reference tab with topic notes.

## Credits

The reference notes under `docs/data/reference/` are copied from [kananinirav/AWS-Certified-Cloud-Practitioner-Notes](https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes), licensed under the MIT License, Copyright (c) 2022 kananinirav.

This repo's own code and content is licensed under the [MIT License](LICENSE).
