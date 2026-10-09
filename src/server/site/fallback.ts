import type { HomepageData, Locale } from "../content/types";

export const locales: Locale[] = ["vi", "en", "ja"];

export function parseLocale(value: string | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null;
}

const copy = {
  vi: {
    message: "Nội dung đang được cập nhật",
    detail: "TNC Handicraft đang hoàn thiện thông tin cho trang này.",
    language: "Ngôn ngữ",
    insights: "Bài viết",
    empty: "Chưa có bài viết nào được xuất bản.",
    read: "Đọc bài viết",
  },
  en: {
    message: "Content is being updated",
    detail: "TNC Handicraft is preparing the information for this page.",
    language: "Language",
    insights: "Insights",
    empty: "No articles have been published yet.",
    read: "Read article",
  },
  ja: {
    message: "コンテンツを更新中です",
    detail: "TNC Handicraft はこのページの情報を準備しています。",
    language: "言語",
    insights: "記事",
    empty: "公開済みの記事はまだありません。",
    read: "記事を読む",
  },
} as const;

export function fallbackHomepage(locale: Locale): HomepageData {
  const text = copy[locale];
  return {
    title: `TNC Handicraft | ${text.message}`,
    description: text.detail,
    nav: {
      brandTitle: "TNC Handicraft",
      brandSubtitle: text.message,
      languageSwitchLabel: text.language,
      links: [{ label: text.insights, target: `/${locale}/insights/` }],
    },
    hero: {
      eyebrow: "TNC Handicraft",
      title: text.message,
      body: text.detail,
      primary: { label: text.insights, target: `/${locale}/insights/` },
      secondary: { label: text.language, target: "#languages" },
      visual: { eyebrow: "TNC Handicraft", pills: [], stats: [] },
    },
    about: { eyebrow: "TNC Handicraft", title: text.message, body: text.detail },
    capabilities: { eyebrow: text.message, title: text.detail, items: [] },
    products: { eyebrow: text.message, title: text.detail, body: text.detail, items: [] },
    insights: {
      eyebrow: "TNC Handicraft",
      title: text.insights,
      body: text.detail,
      emptyMessage: text.empty,
      cardLabel: text.read,
      ctaLabel: text.insights,
      ctaTarget: `/${locale}/insights/`,
    },
    contact: { eyebrow: "TNC Handicraft", title: text.message, cards: [] },
    footer: { title: "TNC Handicraft", description: text.detail, note: "" },
    seo: {
      title: `TNC Handicraft | ${text.message}`,
      description: text.detail,
      image: null,
    },
    primaryMediaAlt: "",
  };
}
