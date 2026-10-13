import assert from 'node:assert/strict';
import test from 'node:test';
import { certificateMatchesReleaseKey, parseApksignerSha256, RELEASE_CERT_SHA256_PREFIX } from '../scripts/apk-cert.mjs';

const SAMPLE = `
Signer #1 certificate DN: CN=Android Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: 2f0da7fe68a5d9b9bcf9e8550d69488b802d30bd3a32d052fbf0a382f906d0a1
Signer #1 certificate SHA-1 digest: 00112233445566778899aabbccddeeff00112233
`;

test('能从 apksigner 输出里读出 SHA-256', () => {
  assert.equal(
    parseApksignerSha256(SAMPLE),
    '2f0da7fe68a5d9b9bcf9e8550d69488b802d30bd3a32d052fbf0a382f906d0a1'
  );
});

test('发布证书前缀必须是 2f0da7fe，冒号和大小写都不影响', () => {
  assert.equal(RELEASE_CERT_SHA256_PREFIX, '2f0da7fe');
  assert.equal(certificateMatchesReleaseKey(parseApksignerSha256(SAMPLE)), true);
  assert.equal(certificateMatchesReleaseKey('2F:0D:A7:FE:AA'), true);
  assert.equal(certificateMatchesReleaseKey('aa0da7fe68a5d9b9'), false);
  assert.equal(certificateMatchesReleaseKey(''), false);
});

test('未签名的 apksigner 输出算证书不匹配', () => {
  assert.equal(parseApksignerSha256('DOES NOT VERIFY\n'), '');
  assert.equal(certificateMatchesReleaseKey(parseApksignerSha256('DOES NOT VERIFY\n')), false);
});
