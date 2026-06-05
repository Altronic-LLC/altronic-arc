import { describe, it, expect } from "vitest";
import {
  extractMentionedEmails,
  isUserMentionedInComment,
  isUserMentionedInComments,
} from "./mentionDetector";

describe("mentionDetector", () => {
  describe("extractMentionedEmails", () => {
    it("extracts emails from mention spans", () => {
      const html =
        '<p>Hey <span class="mention" data-email="alice@example.com">@Alice</span>, check this out.</p>';
      const emails = extractMentionedEmails(html);
      expect(emails).toEqual(new Set(["alice@example.com"]));
    });

    it("extracts multiple mentions from the same HTML", () => {
      const html =
        '<p><span class="mention" data-email="alice@example.com">@Alice</span> and <span class="mention" data-email="bob@example.com">@Bob</span></p>';
      const emails = extractMentionedEmails(html);
      expect(emails).toEqual(new Set(["alice@example.com", "bob@example.com"]));
    });

    it("deduplicates repeated mentions", () => {
      const html =
        '<p><span class="mention" data-email="alice@example.com">@Alice</span> loves <span class="mention" data-email="alice@example.com">@Alice</span></p>';
      const emails = extractMentionedEmails(html);
      expect(emails).toEqual(new Set(["alice@example.com"]));
    });

    it("handles case-insensitive email normalization", () => {
      const html = '<span class="mention" data-email="Alice@Example.COM">@Alice</span>';
      const emails = extractMentionedEmails(html);
      expect(emails).toEqual(new Set(["alice@example.com"]));
    });

    it("returns empty set for HTML with no mentions", () => {
      const html = "<p>No mentions here.</p>";
      const emails = extractMentionedEmails(html);
      expect(emails).toEqual(new Set());
    });

    it("handles empty/null input gracefully", () => {
      expect(extractMentionedEmails("")).toEqual(new Set());
      expect(extractMentionedEmails(null as any)).toEqual(new Set());
      expect(extractMentionedEmails(undefined as any)).toEqual(new Set());
    });
  });

  describe("isUserMentionedInComment", () => {
    it("returns true if user is mentioned", () => {
      const html = '<p><span class="mention" data-email="alice@example.com">@Alice</span></p>';
      expect(isUserMentionedInComment(html, "alice@example.com")).toBe(true);
    });

    it("returns false if user is not mentioned", () => {
      const html = '<p><span class="mention" data-email="bob@example.com">@Bob</span></p>';
      expect(isUserMentionedInComment(html, "alice@example.com")).toBe(false);
    });

    it("handles case-insensitive email matching", () => {
      const html = '<p><span class="mention" data-email="Alice@Example.COM">@Alice</span></p>';
      expect(isUserMentionedInComment(html, "alice@example.com")).toBe(true);
    });

    it("returns false for empty email", () => {
      const html = '<p><span class="mention" data-email="alice@example.com">@Alice</span></p>';
      expect(isUserMentionedInComment(html, "")).toBe(false);
    });
  });

  describe("isUserMentionedInComments", () => {
    it("returns true if user is mentioned in any comment", () => {
      const comments = [
        { bodyHtml: "<p>First comment</p>" },
        { bodyHtml: '<p><span class="mention" data-email="alice@example.com">@Alice</span></p>' },
      ];
      expect(isUserMentionedInComments(comments, "alice@example.com")).toBe(true);
    });

    it("returns false if user is not mentioned in any comment", () => {
      const comments = [
        { bodyHtml: '<p><span class="mention" data-email="bob@example.com">@Bob</span></p>' },
        { bodyHtml: "<p>Another comment</p>" },
      ];
      expect(isUserMentionedInComments(comments, "alice@example.com")).toBe(false);
    });

    it("handles empty comments array", () => {
      expect(isUserMentionedInComments([], "alice@example.com")).toBe(false);
    });

    it("handles empty email", () => {
      const comments = [{ bodyHtml: '<span class="mention" data-email="alice@example.com">@Alice</span>' }];
      expect(isUserMentionedInComments(comments, "")).toBe(false);
    });
  });
});
