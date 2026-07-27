import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.validateLink = (url) => /^(?:https?:|mailto:)/i.test(url.trim());
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};
markdown.renderer.rules.image = (tokens, index) => {
  const alt = markdown.utils.escapeHtml(tokens[index].content || "image");
  return `<span class="markdown-image-placeholder">[Image: ${alt}]</span>`;
};

/** Renders model-authored Markdown with raw HTML and embedded images disabled. */
export function renderAssistantMarkdown(source: string): string {
  return markdown.render(source);
}
