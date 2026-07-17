# TNC Handicraft Website

This repository now uses `Hugo + Decap CMS` for a multilingual company profile site on GitHub Pages.

## Structure

- `content/vi/_index.md`: Vietnamese homepage content
- `content/en/_index.md`: English homepage content
- `content/ja/_index.md`: Japanese homepage content
- `layouts/`: Hugo templates
- `static/`: static assets, root landing page, CMS admin, uploads, and `CNAME`
- `data/settings.yaml`: shared site settings for SEO and branding
- `oauth-proxy/cloudflare-worker/`: sample Decap OAuth proxy for GitHub login

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In GitHub, open `Settings` > `Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main` and wait for the workflow in `.github/workflows/hugo.yaml` to finish.

The workflow builds Hugo and deploys the generated `public/` output to GitHub Pages.

## Local development

Install Hugo locally, then run:

```bash
hugo server
```

The site will be available locally with language paths such as:

- `/vi/`
- `/en/`
- `/ja/`

## Blog / insights

The site now includes an `insights` section for SEO-focused articles:

- `content/vi/insights/`
- `content/en/insights/`
- `content/ja/insights/`

Hugo will generate:

- language-specific article lists
- single article pages
- homepage article previews

This is the section you should keep publishing into for long-tail SEO and better visibility in AI-generated search results.

## Decap CMS

The CMS entry point is:

- `/admin/`

Important:

- `static/admin/config.yml` is now prefilled with:
  - repo: `nhtrung-tnc/tnc`
  - OAuth base URL: `https://oauth.tnchandicraft.com`
- For GitHub Pages, Decap CMS with the GitHub backend requires an OAuth proxy.
- Deploy the Worker and create the GitHub OAuth app before trying to sign in on production.
- `local_backend: true` is already enabled for local CMS development.
- The CMS now includes collections for the multilingual homepage and multilingual insight articles.

## OAuth proxy

A ready-to-adapt Cloudflare Worker example is included in:

- `oauth-proxy/cloudflare-worker/`

Start with:

1. Create a GitHub OAuth app.
2. Deploy the Worker.
3. Point `oauth.tnchandicraft.com` to the Worker.
4. Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Worker secrets.

## Custom domain

This project ships with `static/CNAME` set to:

`tnchandicraft.com`

Set the following DNS records where your domain is managed:

- `A` record for `@` to `185.199.108.153`
- `A` record for `@` to `185.199.109.153`
- `A` record for `@` to `185.199.110.153`
- `A` record for `@` to `185.199.111.153`
- `CNAME` record for `www` to `<your-github-username>.github.io`

After DNS updates, configure the custom domain in GitHub Pages and enable HTTPS.
