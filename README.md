# Roomtone

一張小小的聲音工作桌。把錄音剪到剛好，收好頭尾，帶走一個 WAV。

[開啟工具](https://miiduoa.github.io/roomtone/) · [English](docs/README.en.md) · [操作驗證紀錄](docs/browser-verification.md)

![Roomtone 繁體中文聲音工作台](docs/screenshot.png)

## 可以做什麼

- 從裝置選擇或拖放短音訊；不需上傳或登入。
- 拖曳波形把手、使用鍵盤，或輸入秒數，選取精確到取樣格的範圍。
- 加入線性淡入淡出，選擇是否將取樣峰值正規化至指定 dBFS。
- 在「原始音訊」與「處理後」之間切換，預聽同一段剪輯。
- 匯出單聲道或立體聲的 16-bit PCM WAV，保留**解碼後的工作取樣率**。
- 預設繁體中文，可完整切換英文。內建音軌是程式合成的原創鐘琴片段，沒有使用外部錄音。

這不是多軌編輯器。它專注於整理一小段音效、錄音、採樣或音樂草稿。

## 本機執行

需要 Node.js 24 或更新版本。

```sh
npm ci
npm run dev
```

開啟終端顯示的 `/roomtone/` 網址。`npm test` 執行處理核心與載入生命週期測試，`npm run build` 先檢查 TypeScript，再產出 `dist/`。

## 聲音處理規則

選取範圍使用整數取樣格 `[起點, 終點)`；秒數輸入會四捨五入至最近的取樣格。把手方向鍵移動一格，Shift + 方向鍵移動 0.1 秒；Home / End 移至合法邊界。空白鍵在非輸入控制項上可播放或停止。

處理順序為 **選取 → 線性淡入淡出 → 連動峰值正規化 → PCM16 匯出**。淡入淡出重疊時相乘，正規化使用所有聲道的最大取樣峰值，對左右聲道套用相同增益。靜音不會被放大成無效數值。改動不會寫回原始樣本。

畫面顯示處理後、量化前的取樣峰值與所有聲道樣本的 RMS；**不是 LUFS，也不是真峰值**。超過 ±1 的樣本會在 WAV 匯出時飽和裁切；開啟正規化可調低峰值。處理後預聽使用和匯出相同的量化、裁切樣本；播放裝置仍可能重取樣。PCM16 不加抖動，負滿刻度為 −32768、正滿刻度為 32767。

## 範圍與限制

- 最多 90 秒、40 MB、單聲道或立體聲、1,800 萬個解碼樣本；工作取樣率須介於 8–192 kHz。
- WAV、MP3、M4A、OGG、FLAC 等輸入格式依瀏覽器的媒體解碼能力而定，不保證每種編碼都能開啟。
- 先以本機媒體中繼資料檢查長度，拒絕長錄音；讀取失敗或逾時會顯示錯誤。解碼後還會檢查實際長度、聲道及樣本。瀏覽器的 `decodeAudioData()` 可能重取樣，而且不能中途取消；中繼資料不可靠的檔案仍可能在檢查前造成較高記憶體使用。
- 快速匯入新檔案或調整參數時，舊非同步結果不會覆蓋目前的音軌。數值無效時會還原至上次有效範圍。
- 音訊只存在記憶體，重新整理即清空。只將語言偏好存進 `localStorage`。沒有分析追蹤、外部字型、音訊上傳或第三方 API。
- 桌面與行動版採回應式配置；已執行的瀏覽器測試範圍請看[驗證紀錄](docs/browser-verification.md)，未宣稱完整跨瀏覽器認證。

## 結構與驗證

| 檔案 | 用途 |
| --- | --- |
| `src/audio.ts` | 純 PCM 處理、測量、合成試聽音軌與 WAV 編碼 |
| `src/audio.worker.ts` | 在背景執行處理，以音軌版本排除過期請求 |
| `src/preflight.ts` | 解碼前長度檢查、逾時、中止與物件 URL 清理 |
| `src/main.ts` | 播放、波形、剪輯互動、匯入與匯出 |
| `src/i18n.ts` | 完整繁中與英文文案 |

測試涵蓋取樣格邊界、立體聲增益連動、重疊淡入淡出、單格選取、靜音、無效值、PCM16 裁切、RIFF 標頭與聲道交錯、預聽／匯出一致性、過期 worker 請求，以及中繼資料錯誤和清理。音訊 DSP 測試不等於真實裝置播放測試。

## GitHub Pages

Vite 的 base path 為 `/roomtone/`。Repository 的 **Settings → Pages → Source** 選擇 **GitHub Actions** 後，推送至 `main` 會在 Node 24 上安裝鎖定版本、執行測試與建置，再部署 `dist/`。PR 只驗證，不部署。若改 repository 名稱，請一起修改 `vite.config.ts` 的 base。

## 技術依據

[Web Audio 解碼與取樣率](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) · [Web Audio 播放](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start) · [PCM 格式欄位](https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatex)

MIT © 2026 Miiduoa
