# Contributing

Bug fixes are welcome as pull requests. For a new feature or a bigger change,
open an issue first and wait for a yes, so nobody spends time on work that
will not be merged.

## Terms

The code is licensed under the [AGPL](LICENSE). The prebuilt binaries are
sold under separate [pricing terms](https://ampliflare.purplecandy.dev/docs/license/),
which pay for the work. For that to keep working with your code in it, a pull
request is accepted on these terms:

- Your contribution is licensed under the AGPL, like the rest of the code.
- You also give Nadeem Siddique a permanent, worldwide, royalty-free right to
  use, change and distribute your contribution under other terms, including
  in the paid binaries.
- You wrote it, or have the right to give it under these terms.

You keep the copyright to your contribution.

## Before you send it

- Follow [CLAUDE.md](CLAUDE.md) for the stack, the tests and how to run the app
  with files loaded.
- Run `cd src-tauri && cargo test` and `pnpm build`.
- Write the commit subject in plain words, under 60 characters.
