# Publishing `truffle-text`

The Truffle code is MIT licensed and the complete Ubuntu Font Licence is
included. Before publishing, independently decide whether the available Volter
(Goldfish) attribution and public “100% Free” classification are sufficient
for your redistribution risk.

```bash
cd C:\Users\steet\Desktop\truffle-text
npm login
npm whoami
npm run verify
npm pack --dry-run
npm pack
```

Install the generated `.tgz` into a clean website or Nitro checkout and test:

```bash
yarn add C:\Users\steet\Desktop\truffle-text\truffle-text-1.0.0.tgz
npx truffle-setup --out public/assets/truffle
```

After that succeeds:

```bash
npm publish --access public
```

For later releases, update the version in
`truffle-text-dev/release/public-package/package.json`, run the private sync
script again, and then pack and publish from `truffle-text`.
