import { describe, expect, it } from "vitest";
import { buildPartnerApprovedEmail, emailSiteUrl } from "./approval-email";

describe("emailSiteUrl", () => {
  it("never puts a localhost link in an email", () => {
    expect(emailSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3001" })).toBe("https://bluepass.co");
    expect(emailSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000/" })).toBe("https://bluepass.co");
    expect(emailSiteUrl({})).toBe("https://bluepass.co");
  });

  it("uses the configured live site, or an explicit override", () => {
    expect(emailSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://bluepass.co/" })).toBe("https://bluepass.co");
    expect(emailSiteUrl({ EMAIL_LINK_BASE_URL: "https://staging.bluepass.co", NEXT_PUBLIC_SITE_URL: "http://localhost:3001" })).toBe(
      "https://staging.bluepass.co"
    );
  });
});

describe("buildPartnerApprovedEmail", () => {
  const email = buildPartnerApprovedEmail({
    name: "Adarsh S S",
    referralUrl: "https://bluepass.co/?ref=adarsh-s-s",
    dashboardUrl: "https://bluepass.co/partner",
  });

  it("congratulates them by first name and gives their link and dashboard", () => {
    expect(email.subject).toBe("You're a BluePass partner");
    expect(email.text).toContain("Hi Adarsh,");
    expect(email.text).toContain("https://bluepass.co/?ref=adarsh-s-s");
    expect(email.text).toContain("https://bluepass.co/partner");
    expect(email.html).toContain('href="https://bluepass.co/partner"');
  });

  it("makes no promise about a commission rate", () => {
    expect(email.text).not.toMatch(/\d+\s?%/);
  });

  it("escapes a name that contains markup", () => {
    const risky = buildPartnerApprovedEmail({ name: "<b>Eve</b>", referralUrl: "https://bluepass.co/?ref=e", dashboardUrl: "https://bluepass.co/partner" });
    expect(risky.html).not.toContain("<b>Eve</b>");
  });

  it("still greets someone with no name on file", () => {
    expect(buildPartnerApprovedEmail({ name: null, referralUrl: "x", dashboardUrl: "y" }).text.startsWith("Hi,")).toBe(true);
  });
});
