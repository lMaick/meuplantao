@echo off
call "C:\Users\Maick\AppData\Roaming\npm\codex.cmd" ^
  -c "model='muse-spark-1.3-contributor'" ^
  -c "model_provider='opencode-go'" ^
  -c "model_reasoning_effort='high'" ^
  -c "check_for_update_on_startup=false" ^
  -c "model_providers.opencode-go.name='OpenCode Go'" ^
  -c "model_providers.opencode-go.base_url='https://opencode.ai/zen/go/v1'" ^
  -c "model_providers.opencode-go.env_key='OPENCODE_API_KEY'" ^
  -c "model_providers.opencode-go.wire_api='responses'" ^
  -c "features.apps=false" ^
  -c "features.plugins=false" ^
  -c "features.browser_use=false" ^
  -c "features.computer_use=false" ^
  -c "mcp_servers.node_repl.enabled=false" ^
  %*
