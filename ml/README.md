# ML research references

The notebook in `notebooks/` is the broader research and experimentation reference developed earlier for Team 4. It is not the web service's production inference path. Real production and prototype code are in `services/speech-api/sauti_ml`.

Use the notebook to discuss pretrained speech models, Kenyan English / Kiswahili data, safety evaluation and future fine tuning experiments. Review each dataset's license and access restrictions before use. Keep co-designer recordings outside the repository.

The executable prototype pipeline here uses *frozen pretrained embeddings* followed by speaker-specific prototypes. It is personalization via transfer learning, not gradient fine tuning of the encoder. A parameter efficient fine tuning stage is a planned, separately evaluated Codex work package, and should only be released if it beats the prototype model on untouched test data without increasing unsafe actions.
