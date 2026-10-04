import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, connectTestSshFromConnectionsPage, ensureTestSshConnection } from '../../support/ssh';

test.use({
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  isMobile: false,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});

for (const erase of ['full screen', 'individual rows'] as const) {
  test(`wide touch terminal removes old TUI rows and colored cells using ${erase} across viewport changes`, async ({
    page,
    context,
  }) => {
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    const connectionId = await ensureTestSshConnection(context.request);
    await connectTestSshFromConnectionsPage(page, connectionId);
    const terminal = page.locator('.terminal-inner-container');
    const command = page.locator('.command-bar-command-input');
    // A real remote input loop redraws on r and exits on q. This tests ANSI and
    // browser resize ordering, not SIGWINCH: the pipe-based SSH fixture cannot
    // model the remote PTY's signal semantics.
    const wideText = '旧字残留中文边界';
    const wideTextBase64 = Buffer.from(wideText).toString('base64');
    const eraseSequence = erase === 'full screen' ? '\\033[2J\\033[H' : '\\033[12;1H\\033[2K\\033[1;1H\\033[2K';
    await command.fill(
      `wide=$(printf '${wideTextBase64}' | base64 -d); printf "\\033[?1049h"; frame=0; while IFS= read -rsn1 key; do if [[ "$key" == s ]]; then printf "\\033[0m\\033[2J\\033[H\\033[48;2;173;37;59mOLD_%s %s\\033[0m\\033[12;1HOLD_%s" TUI_HEADER "$wide" TUI_FOOTER; elif [[ "$key" == r ]]; then frame=$((frame+1)); printf "\\033[0m${eraseSequence}NEW_%s_%s" TUI_SCREEN "$frame"; elif [[ "$key" == q ]]; then break; fi; done; printf "\\033[?1049l\\nREDRAW_%s\\n" EXIT_OK`,
    );
    await command.press('Enter');
    const coloredCells = () =>
      terminal
        .locator('.xterm-rows span')
        .evaluateAll(
          (cells) => cells.filter((cell) => getComputedStyle(cell).backgroundColor === 'rgb(173, 37, 59)').length,
        );
    let frame = 0;
    for (const viewport of [
      { width: 650, height: 700 },
      { width: 1180, height: 820 },
      { width: 820, height: 600 },
    ]) {
      await command.fill('s');
      await command.press('Enter');
      await expect(terminal).toContainText('OLD_TUI_HEADER');
      await expect(terminal).toContainText(wideText);
      await expect(terminal).toContainText('OLD_TUI_FOOTER');
      await expect.poll(coloredCells).toBeGreaterThan(0);
      await page.setViewportSize(viewport);
      await command.fill('r');
      await command.press('Enter');
      await expect(terminal).toContainText(`NEW_TUI_SCREEN_${++frame}`);
      await expect(terminal).not.toContainText('OLD_TUI_HEADER');
      await expect(terminal).not.toContainText(wideText);
      await expect(terminal).not.toContainText('OLD_TUI_FOOTER');
      await expect.poll(coloredCells).toBe(0);
    }
    await command.fill('q');
    await command.press('Enter');
    await expect(terminal).toContainText('REDRAW_EXIT_OK');
  });
}
