// Test fixture for msgtype.test.ts: re-export the generated `MsgType` the way
// a downstream barrel would, so the test can pin that the const and its
// same-name type alias travel through the re-export together. Not part of the
// published package (tsup only bundles index.ts).
export { MsgType } from './index';
