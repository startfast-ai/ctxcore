class Ctxcore < Formula
  desc "Persistent, intelligent memory for Claude Code"
  homepage "https://github.com/ctxcore/ctxcore"
  url "https://registry.npmjs.org/ctxcore/-/ctxcore-0.1.0.tgz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def post_install
    ohai "ctxcore installed successfully!"
    ohai "Run 'ctxcore init' in your project directory to get started."
    ohai ""
    ohai "Recommended: install Ollama for semantic search"
    ohai "  brew install ollama"
    ohai "  ollama pull qwen3-embedding:0.6b"
  end

  def caveats
    <<~EOS
      ctxcore works best with Ollama for semantic embeddings.
      Without Ollama, search falls back to keyword-only mode.

      To install Ollama and the recommended model:
        brew install ollama
        ollama serve &
        ollama pull qwen3-embedding:0.6b

      Then initialize ctxcore in your project:
        cd your-project
        ctxcore init
    EOS
  end

  test do
    assert_match "ctxcore", shell_output("#{bin}/ctxcore --version")
  end
end
