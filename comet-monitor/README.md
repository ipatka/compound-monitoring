# Compound cToken Event Monitor

## Description

This bot monitors Compound Finance comet contracts for common market events like Supply, Borrow,
etc.  Monitored events are specified in the bot-config.json file, with associated Finding types
and severities for each one.


## Alerts

<!-- -->
- SA-COMP-COMET-EVENT
  - Emitted for any event specified in `bot-config.json`
  - Type is set to event specific value in `bot-config.json`
  - Severity is set to event specific value in `bot-config.json`

## Testing

Supply (USDC) - 0x18cf5e75d5f23eb951978007e60e84d386098bb13d38e570575ecf37fb9913bb
Supply Collateral (LINK) - 0x14dea3b30e10bacd952a907d5ef1ffbce8edb3d7a48f569355ed40551ad87f23
Withdraw (USDC) - 0x462e713e26cef1eb910eb785901cee9874796364e6824f12831f47b9c8d71776
Withdraw Collateral (WETH) - 0x80c4c0c6297be30fd8f888bc518d605926c2a073412ae08ef861d8cb83790edb