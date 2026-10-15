-- Customer-facing display-name refresh. Keep immutable identifiers, rule versions,
-- archived data, trade ledgers, and existing admin-customised labels unchanged.
-- This does NOT license or certify any paywalled strategy methodology.
UPDATE strategy_definitions SET name='Leveraged Nasdaq Quarterly Target'
 WHERE key='9sig' AND name='9Sig';
UPDATE strategy_definitions SET name='Small-Cap Quarterly Target (research pending)'
 WHERE key='3sig' AND name='3SIG (research pending)';
UPDATE strategy_definitions SET name='Leveraged Mid-Cap Quarterly Target (research pending)'
 WHERE key='6sig' AND name='6SIG (research pending)';
UPDATE strategy_definitions SET name='Wealtharr Income & Reserve Model'
 WHERE key='income-sig' AND name='Income Sig (Jason Kelly)';
