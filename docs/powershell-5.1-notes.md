# Windows PowerShell 5.1 踩坑速查

本文件记录本项目在开发过程中**真实踩到**的 PowerShell 5.1 问题。
不必通读 —— 遇到莫名其妙的报错时按症状查。

> **根本建议：装 PowerShell 7 并用 `pwsh`。**
> 下面绝大多数坑在 7 里已默认修好。
> 安装：`winget install --id Microsoft.PowerShell --source winget`
>
> 当前项目里的 `.ps1` 脚本在两者下都能跑，但**推荐用 `pwsh` 执行**。

---

## 1. 中文脚本报"字符串缺少终止符"之类的语法错误

**症状**：一个明明正常的 `.ps1`，运行时报
`字符串缺少终止符`、`Unexpected token` 之类，且错误位置莫名其妙。

**原因**：Windows PowerShell 5.1 **默认按 GBK 读取 `.ps1` 文件**。
脚本里的中文注释/字符串被解成乱码后，可能撞上引号或括号，破坏语法结构。

**解法（二选一）**

- 给文件加 **UTF-8 BOM**（本项目 `tools/*.ps1` 都带 BOM）：
  ```powershell
  # 用 Node 加 BOM（比用编辑器可靠）
  node -e "const fs=require('fs'),p='tools/xxx.ps1';let s=fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');fs.writeFileSync(p,'\uFEFF'+s,'utf8')"
  ```
- 或者装 PowerShell 7 —— 它默认按 UTF-8 读取，不需要 BOM。

**注意**：用某些编辑器重新保存后 BOM 可能丢失，症状会重新出现。

---

## 2. `ConvertFrom-Json` 报"应为 : 或 }"

**症状**：读一个合法 JSON 文件却报 JSON 格式错误。

**原因**：同样是编码 —— 按 GBK 读 UTF-8 文件，中文被解坏，JSON 语法随之崩掉。

**解法**：显式指定编码，或改用 Node 读：

```powershell
# PowerShell 里显式 UTF-8
Get-Content data.json -Raw -Encoding UTF8 | ConvertFrom-Json
```

```bash
# 更可靠：用 Node
node -e "console.log(Object.keys(require('./data.json')).length)"
```

---

## 3. `Invoke-WebRequest -MaximumRedirection 0` 拿不到状态码

**症状**：想读一个 301/302 的 `Location`，结果抛
`对象的当前状态使该操作无效`，且异常里**没有 `Response` 对象**，
`$_.Exception.Response` 为 `$null`，拿不到状态码。

**原因**：5.1 的已知缺陷 —— 重定向时抛的异常不携带响应。

**解法**：改用 .NET 的 `HttpWebRequest`：

```powershell
function Get-RedirectTarget([string]$url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.AllowAutoRedirect = $false
    $req.Timeout = 20000
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode; $loc = $resp.Headers['Location']
    $resp.Close()
    return @{ code = $code; loc = $loc }
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if ($r) {
      $code = [int]$r.StatusCode; $loc = $r.Headers['Location']
      $r.Close()
      return @{ code = $code; loc = $loc }
    }
    return @{ code = 0; loc = $null }
  }
}
```

**或者**：干脆跟随重定向（默认行为），判断最终是否 200 —— 这也更贴近访客的真实体验。

---

## 4. `$home = ...` 赋值直接报错

**症状**：`Cannot overwrite variable HOME because it is read-only or constant.`

**原因**：`$HOME`（以及 `$PID`、`$HOST` 等）是只读内置变量。

**解法**：换个名字，如 `$homeResp`、`$homePage`。

**教训**：这类报错会让**后续依赖该变量的检查静默失效** ——
不报错、但结果永远为空，看上去像"检查通过"。命名时避开内置变量。

---

## 5. 属性值里含 `>` 的标签，用正则数标签会数错

**症状**：写了个"HTML 标签配平检查器"，报出大量**误报**
（例如把正常的 `<button>` 判为未闭合）。

**原因**：`/<div[^>]*>/` 这类正则遇到属性值里含 `>` 就会提前结束匹配。
Vue 模板里 `v-if="a > b"`、`v-html="icon('x')"` 都可能踩到。

**解法**：**不要自己写 HTML 解析器**。用浏览器解析：

```js
// 在无头浏览器里检查 DOM，比正则可靠得多
const mounted = await evaluate(`!!document.querySelector('nav button')`);
```

本项目已把这个思路做成 `tools/check-html-structure.js`。

---

## 6. 生成脚本里嵌套模板字符串的转义陷阱

**症状**：用 Node 脚本生成 `.js` 文件时，产物里的
`${xxx}` 变成了写死的值，导致运行时行为不对（且**不报错**）。

**原因**：生成脚本的外层模板字符串会把 `${}` 当作插值求值，
而不是原样写进产物。若被插值的变量在生成时不存在，轻则报错，
重则把 `undefined` 或空串写进产物。

**解法**：**生成的代码用字符串拼接书写，模板里不放任何 `${}` 插值**
（需要注入数据时用占位符 + `replace`）。

本项目 `tools/build-botanical.js` 因此被重写过一次 ——
当时的症状是入场动画的"描边生长"完全不跑，只有"淡入"在工作，
而且没有任何报错，靠量化各属性的数值变化才发现。

---

## 7. 内联 `node -e "..."` 引号被吃掉

**症状**：在 PowerShell 里写 `node -e "console.log('a')"`，
报 `SyntaxError`，且错误信息里的代码被截断或错位。

**原因**：5.1 的参数转义规则老旧，引号与反斜杠的处理与
bash / PowerShell 7 都不同。嵌套引号尤其容易出问题。

**解法（推荐）**：**把脚本写成文件**再 `node tools/xxx.js`。
这也能避免"同一段命令在 7 里能跑、在 5.1 里不能"的差异。

若必须内联，用单引号包外层：

```powershell
node -e 'console.log("a")'
```

---

## 8. `$OutputEncoding` / `[Console]::OutputEncoding` 影响中文显示

**症状**：脚本输出中文变成 `锟斤拷` 或方块。

**原因**：控制台输出编码与脚本源码编码不一致。

**解法**

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
```

PowerShell 7 默认就是 UTF-8，通常不需要设置。

---

## 一句话总结

本项目里 **80% 的 PowerShell 麻烦都来自两件事**：

1. **编码**（5.1 默认 GBK）
2. **参数/字符串转义**（5.1 规则老旧）

两者在 PowerShell 7 里都默认解决。
若连 7 也不方便装，**把工具脚本写成 Node** 同样能彻底绕开
—— 本项目已有 20 多个 Node 工具脚本，就是出于这个原因。
