import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { resolveWikilinksToMarkdown } from "./wikilinks";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: ["href", "title", "className"],
    span: ["className", "title"],
    code: ["className"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
};

export const stripFrontmatter = (source: string): string => {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
};

export const renderMarkdown = async (
  source: string,
  knownArticles: ReadonlyArray<{ slug: string; title: string }> = []
): Promise<string> => {
  const cleaned = stripFrontmatter(source);
  const preprocessed = resolveWikilinksToMarkdown(cleaned, knownArticles);

  const result = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .process(preprocessed);

  return String(result);
};
