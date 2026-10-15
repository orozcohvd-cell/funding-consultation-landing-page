'use strict';

// Local-only maintenance script. It reads active legacy manual blocks and
// asserts their HMACs centrally. Neither raw phone values nor HMACs are logged.
const { supabaseRequest } = require('../api/_lib/supabase');
const { assertPhoneBlock, normalizeLegacyStoredPhone } = require('../api/_lib/central-phone-block');

const PAGE_SIZE = 100;

function pagePath(afterId) {
  const query = new URLSearchParams({
    select: 'id,phone',
    order: 'id.asc',
    limit: String(PAGE_SIZE),
  });
  if (afterId) query.set('id', `gt.${afterId}`);
  return `/rest/v1/submission_blocks?${query.toString()}`;
}

async function main() {
  if (process.env.CENTRAL_PHONE_BLOCK_BACKFILL_CONFIRM !== '1') {
    console.error('Refusing to run without CENTRAL_PHONE_BLOCK_BACKFILL_CONFIRM=1.');
    process.exitCode = 1;
    return;
  }

  let afterId = '';
  let scanned = 0;
  let asserted = 0;
  let skippedInvalid = 0;

  while (true) {
    const blocks = await supabaseRequest(pagePath(afterId));
    if (!Array.isArray(blocks) || !blocks.length) break;

    for (const block of blocks) {
      scanned += 1;
      const canonicalPhone = normalizeLegacyStoredPhone(block.phone);
      if (!canonicalPhone) {
        skippedInvalid += 1;
        continue;
      }
      await assertPhoneBlock(canonicalPhone, `submission-block:${block.id}`);
      asserted += 1;
    }

    afterId = blocks[blocks.length - 1].id;
    if (blocks.length < PAGE_SIZE) break;
  }

  console.log(JSON.stringify({ scanned, asserted, skippedInvalid }));
}

main().catch(() => {
  console.error('Central phone-block backfill failed. No phone data or HMAC was printed.');
  process.exitCode = 1;
});
