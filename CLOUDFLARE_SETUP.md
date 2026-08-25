# Cloudflare Pages 設定手順（Bay NYX 本番環境）

Bay NYX は **Cloudflare Pages へそのままデプロイできる構成**です。
GitHub の `main` ブランチを Cloudflare Pages に接続すると、HTML / CSS / JavaScript と Pages Functions が同時にデプロイされます。

> APIキーの値そのものは GitHub・チャット・スクリーンショットへ貼り付けないでください。

---

## 1. 構成

静的HTMLサイトのため、アプリケーションビルドは不要です。

| 種類 | ファイル |
| --- | --- |
| トップページ | `index.html` |
| Serviceページ | `service.html` |
| スタイル | `styles.css` |
| microCMS描画 | `cms-content.js` |
| Cloudflare API | `functions/api/[endpoint].js` |
| 旧API互換 | `functions/api/baynyx.js` |
| Functions対象ルート | `_routes.json` |

新しいmicroCMS APIは次のURLで公開されます。

```text
functions/api/[endpoint].js
  ├─ /api/food-menu
  └─ /api/staff
```

`cms-content.js` は Cloudflare の `/api/...` を最初に試し、利用できない場合だけ Netlify Functions へフォールバックします。
そのため同じリポジトリを Cloudflare / Netlify のどちらでも利用できます。

---

## 2. Cloudflare Pages プロジェクト作成

Cloudflare Dashboard で以下を設定します。

1. **Workers & Pages** を開く
2. **Create application** または **Create**
3. **Pages** を選択
4. **Connect to Git**
5. GitHub の `hiroyukimaekawa-lang/Bay-NYX` を選択

設定値：

| 項目 | 設定値 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | 空欄（リポジトリルート） |
| Build command | `exit 0` |
| Build output directory | `.` |

`functions/` はリポジトリルートに置いたままにしてください。
Cloudflare Pages が Pages Functions として自動認識します。

---

## 3. Variables and Secrets

Cloudflare Pages プロジェクトの
**Settings → Variables and Secrets** で設定します。

| 変数名 | 種類 | 必須 | 値 |
| --- | --- | --- | --- |
| `MICROCMS_API_KEY` | Secret | 必須 | microCMS の GET 権限付きAPIキー |
| `MICROCMS_SERVICE_DOMAIN` | Text | 推奨 | `l9pawk28o1` |

`MICROCMS_SERVICE_DOMAIN` は未設定でも `l9pawk28o1` を既定値として使用しますが、環境を明示するため設定を推奨します。

旧構成で使用していた `MICROCMS_ENDPOINT` は、新しい `food-menu` / `staff` APIでは不要です。
残っていても動作には影響しません。

### Production / Preview

Preview Deployment でもmicroCMSを確認する場合は、Production と Preview の両方に変数を設定してください。

環境変数を追加・変更した場合は、Cloudflare Pages の最新デプロイを **Retry deployment** してください。

---

## 4. microCMS側

使用するAPI：

```text
food-menu
staff
```

料理の初期登録例：

```text
ochazuke
sortOrder: 80
isVisible: true

petit-pizza
sortOrder: 100
isVisible: true
```

APIキーは最低限 **GET権限** を付与してください。

---

## 5. デプロイ後のAPI確認

Cloudflare Pages のドメインが、例として

```text
https://bay-nyx.pages.dev
```

の場合、以下をブラウザで確認します。

### 料理

```text
https://bay-nyx.pages.dev/api/food-menu
```

正常時：

```json
{
  "contents": [
    {
      "key": "ochazuke",
      "name": "お茶漬け"
    }
  ]
}
```

### スタッフ

```text
https://bay-nyx.pages.dev/api/staff
```

`staff` APIをまだ作っていない場合は `502` になることがありますが、サイト側は既存HTMLのGolden Cardsを表示するためページ全体は壊れません。

### 主なエラー

| 結果 | 意味 |
| --- | --- |
| `200` | 正常 |
| `503 {"error":"not_configured"}` | `MICROCMS_API_KEY` 未設定 |
| `502 {"error":"upstream_error"}` | APIキー・API名・microCMS設定を確認 |
| `404` | Cloudflare Pages Functions がデプロイされていない／URL違い |

---

## 6. ページ確認

料理：

```text
/service
または
/service.html
```

確認項目：

- お茶漬けがmicroCMS画像に置き換わる
- プチピザがmicroCMS画像に置き換わる
- その他9料理が消えない
- 新しい料理をmicroCMSで追加すると自動追加される
- `sortOrder` で並び順が変わる
- `isVisible = false` で非表示になる

スタッフ：

```text
/#cast
```

確認項目：

- `staff` APIに登録した既存スタッフだけCMS内容に更新される
- 新規スタッフはGolden Cardsへ追加される
- CMS取得失敗時は既存カードが残る

---

## 7. microCMS更新時の反映

microCMSでコンテンツを変更して **公開** した場合、HTMLの再デプロイは不要です。

```text
microCMSで編集
↓
公開
↓
Cloudflare Pages Functionが最新データを取得
↓
サイトへ反映
```

APIレスポンスは短時間キャッシュしています。
通常は **約1〜2分程度** を目安に反映されます。

---

## 8. GitHub更新時

HTML / CSS / JavaScript / Functions を変更した場合：

```text
GitHub mainへpush
↓
Cloudflare Pagesが自動ビルド
↓
本番反映
```

静的サイトなのでビルドコマンドは `exit 0` のままで問題ありません。

---

## 9. `_routes.json`

ルートには以下を配置しています。

```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

これにより Pages Functions の実行対象を `/api/*` に限定し、HTML・CSS・画像等の通常アクセスで不要なFunctions実行が発生しないようにします。

---

## 10. Netlifyとの並行運用

Cloudflare Pagesの確認が完了するまでは、現在のNetlifyサイトを停止する必要はありません。

フロントエンドは次の順でAPIを試します。

```text
Cloudflare: /api/food-menu
↓ 失敗時
Netlify: /.netlify/functions/food-menu
```

スタッフも同様です。

Cloudflareで表示確認が完了した後、独自ドメインをCloudflare Pagesへ向ければ移行完了です。

---

## 11. ローカル確認（開発者向け）

Wranglerを使う場合：

```bash
npx wrangler pages dev .
```

ローカル用のSecretは `.dev.vars` へ記載します。

```text
MICROCMS_API_KEY=xxxxxxxx
MICROCMS_SERVICE_DOMAIN=l9pawk28o1
```

`.dev.vars` はGitへコミットしないでください。
