export type Locale = "vi" | "en" | "ja";
export type ContentType = "homepage" | "insight" | "settings";
export type Role = "admin" | "editor";

export interface Actor {
  id: string;
  subject: string;
  email: string;
  role: Role;
}

export interface MediaRef {
  mediaId: string;
  alt: string;
}

export interface Seo {
  title: string;
  description: string;
  image: MediaRef | null;
}

export interface LinkItem {
  label: string;
  target: string;
}

export interface TextItem {
  title: string;
  body: string;
}

export interface HomepageData {
  title: string;
  description: string;
  nav: {
    brandTitle: string;
    brandSubtitle: string;
    languageSwitchLabel: string;
    links: LinkItem[];
  };
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primary: LinkItem;
    secondary: LinkItem;
    visual: {
      eyebrow: string;
      pills: TextItem[];
      stats: Array<{ value: string; label: string }>;
    };
  };
  about: { eyebrow: string; title: string; body: string };
  capabilities: { eyebrow: string; title: string; items: TextItem[] };
  products: { eyebrow: string; title: string; body: string; items: TextItem[] };
  insights: {
    eyebrow: string;
    title: string;
    body: string;
    emptyMessage: string;
    cardLabel: string;
    ctaLabel: string;
    ctaTarget: string;
  };
  contact: {
    eyebrow: string;
    title: string;
    cards: Array<{ title: string; body?: string; list?: string[] }>;
  };
  footer: { title: string; description: string; note: string };
  seo: Seo;
  primaryMediaAlt: string;
}

export interface InsightData {
  title: string;
  description: string;
  bodyMarkdown: string;
  author: string;
  displayDate: string;
  seo: Seo;
  primaryMediaAlt: string;
}

export interface SettingsData {
  siteName: string;
  companyName: string;
  tagline: string;
  seo: Seo;
  primaryMediaAlt: string;
}

export interface SharedData {
  primaryMediaId: string | null;
}

export type LocaleData = HomepageData | InsightData | SettingsData;

export type Snapshot =
  | { type: "homepage"; slug: string; shared: SharedData; data: HomepageData }
  | { type: "insight"; slug: string; shared: SharedData; data: InsightData }
  | { type: "settings"; slug: string; shared: SharedData; data: SettingsData };

export interface Draft {
  itemId: string;
  locale: Locale;
  version: number;
  sharedVersion: number;
  snapshot: Snapshot;
  publishedRevisionId: string | null;
}

export interface Published {
  itemId: string;
  locale: Locale;
  revisionId: string;
  publishedAt: string;
  snapshot: Snapshot;
}
