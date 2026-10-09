import type { MediaRef } from "../../src/server/content/types";

export const makeSeo = () => ({
  title: "TNC Handicraft",
  description: "Handcrafted collections for global buyers.",
  image: null as MediaRef | null,
});

export const makeHomepage = () => ({
  type: "homepage",
  slug: "home",
  shared: { primaryMediaId: null as string | null },
  data: {
    title: "TNC Handicraft",
    description: "Company profile",
    nav: {
      brandTitle: "TNC Handicraft",
      brandSubtitle: "Handcrafted collections",
      languageSwitchLabel: "Language",
      links: [{ label: "About", target: "#about" }],
    },
    hero: {
      eyebrow: "Company profile",
      title: "Made by hand",
      body: "A clear introduction.",
      primary: { label: "Contact", target: "#contact" },
      secondary: { label: "Products", target: "#products" },
      visual: {
        eyebrow: "Focus",
        pills: [{ title: "Design", body: "Product development" }],
        stats: [{ value: "B2B", label: "Global buyers" }],
      },
    },
    about: { eyebrow: "About", title: "A reliable partner", body: "About TNC" },
    capabilities: {
      eyebrow: "Capabilities",
      title: "From idea to shipment",
      items: [{ title: "Quality", body: "Quality control" }],
    },
    products: {
      eyebrow: "Products",
      title: "Product groups",
      body: "Our collections",
      items: [{ title: "Home decor", body: "Natural materials" }],
    },
    insights: {
      eyebrow: "Insights",
      title: "Knowledge",
      body: "Useful articles",
      emptyMessage: "No articles yet.",
      cardLabel: "Read",
      ctaLabel: "All articles",
      ctaTarget: "/en/insights/",
    },
    contact: {
      eyebrow: "Contact",
      title: "Work with us",
      cards: [{ title: "Company", body: "Contact details", list: ["TNC Handicraft"] }],
    },
    footer: { title: "TNC Handicraft", description: "Company profile", note: "" },
    seo: makeSeo(),
    primaryMediaAlt: "Handcrafted product",
  },
});

export const makeInsight = () => ({
  type: "insight",
  slug: "natural-materials",
  shared: { primaryMediaId: null as string | null },
  data: {
    title: "Natural materials",
    description: "How natural materials support product storytelling.",
    bodyMarkdown: "## Material story\n\nUseful content.",
    author: "TNC Handicraft",
    displayDate: "2026-10-09",
    seo: makeSeo(),
    primaryMediaAlt: "Natural material product",
  },
});

export const makeSettings = () => ({
  type: "settings",
  slug: "settings",
  shared: { primaryMediaId: null as string | null },
  data: {
    siteName: "TNC Handicraft",
    companyName: "TNC Handicraft",
    tagline: "Handcrafted collections for global buyers.",
    seo: makeSeo(),
    primaryMediaAlt: "TNC Handicraft",
  },
});

export const makeActor = (role: "admin" | "editor") => ({
  id: `user-${role}`,
  subject: `subject-${role}`,
  email: `${role}@example.com`,
  role,
});
