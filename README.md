# TNC Handicraft Website

Static company profile website for GitHub Pages with three languages:

- Vietnamese: `/vi/`
- English: `/en/`
- Japanese: `/ja/`

## Deploy on GitHub Pages

1. Create a GitHub repository.
2. Upload all files in this folder to the repository root.
3. In GitHub, open `Settings` > `Pages`.
4. Choose `Deploy from a branch`.
5. Select branch `main` and folder `/(root)`.
6. Wait for the first deployment to complete.

## Custom domain

This project includes a `CNAME` file for:

`tnchandicraft.com`

Set the following DNS records where your domain is managed:

- `A` record for `@` to `185.199.108.153`
- `A` record for `@` to `185.199.109.153`
- `A` record for `@` to `185.199.110.153`
- `A` record for `@` to `185.199.111.153`
- `CNAME` record for `www` to `<your-github-username>.github.io`

After DNS updates, set the custom domain in GitHub Pages and enable HTTPS.
