import {
  isCopyHighlighted,
  normalizeCopyText,
} from "../src/copyImage.ts";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

assertEqual(
  normalizeCopyText("registry/app:v1"),
  "registry/app:v1",
  "single-line image should stay unchanged",
);

assertEqual(
  normalizeCopyText("line-a\nline-b"),
  "line-a  line-b",
  "multi-line display should collapse newlines for clipboard",
);

assertEqual(
  isCopyHighlighted(null, "registry/app:v1"),
  false,
  "null copied should not highlight",
);

assertEqual(
  isCopyHighlighted("registry/app:v1", "registry/app:v1"),
  true,
  "exact match should highlight",
);

assertEqual(
  isCopyHighlighted("registry/other:v1", "registry/app:v1"),
  false,
  "different image should not highlight upload row",
);

assertEqual(
  isCopyHighlighted("line-a  line-b", "line-a\nline-b"),
  true,
  "fallback row should highlight after multi-line copy",
);

assertEqual(
  isCopyHighlighted("line-a\nline-b", "line-a\nline-b"),
  false,
  "raw multi-line copied value must not match display string",
);
