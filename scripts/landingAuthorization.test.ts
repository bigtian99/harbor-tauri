import { readFileSync } from "node:fs";

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

const channelFormSource = readFileSync("src/components/landing/LandingChannelForm.tsx", "utf8");
const landingHookSource = readFileSync("src/hooks/useLanding.ts", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");

assertContains(
  channelFormSource,
  "onOpenAuthorization",
  "Landing Authorization field should expose an auto-fetch action",
);
assertContains(
  channelFormSource,
  "自动获取",
  "Landing Authorization field should render the auto-fetch button",
);
assertContains(
  channelFormSource,
  "PasswordInput",
  "Landing Authorization field should keep masking the token",
);

assertContains(
  landingHookSource,
  '"ops-auth-token-captured"',
  "Landing should listen to the shared ops login token capture event",
);
assertContains(
  landingHookSource,
  '"open_ops_login_window"',
  "Landing auto-fetch should reuse the embedded ops login window",
);
assertContains(
  landingHookSource,
  '"close_ops_login_window"',
  "Landing auto-fetch should close the login window once the token arrives",
);
assertContains(
  landingHookSource,
  "setVestAuthorization(token)",
  "Landing auto-fetch should fill the Authorization input with the captured token",
);

assertContains(
  appSource,
  "onOpenAuthorization={landing.handleOpenAuthorizationLogin}",
  "LandingPanel should receive the auto-fetch handler",
);
