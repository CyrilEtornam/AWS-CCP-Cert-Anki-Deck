# AWS-CCP-Cert-Anki-Deck
An Anki deck to help with studying for the AWS Certified Cloud Practitioner exam. Mostly based off of content presented in Exampro course [https://www.youtube.com/watch?v=3hLmDS179YE&t=1397s](https://www.youtube.com/watch?v=3hLmDS179YE&t=1397s).

## Study online

The same deck is also available as an installable, offline-first web app — no Anki install required. Visit the site once while online (it caches itself for offline use afterward), or add it to your phone's home screen:

**https://cyriletornam.github.io/AWS-CCP-Cert-Anki-Deck/**

It includes spaced-repetition flashcards (cloze + multiple choice, pulled from `AWS_CCP_Cert/AWS_CCP_Cert.json`) and a browsable reference tab with topic notes. Source lives in [docs/](docs/); regenerate the data files with `python3 scripts/build-data.py` after editing the deck, and `python3 scripts/gen-icons.py` if the app icon needs to change.
