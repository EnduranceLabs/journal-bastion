class JournalBastion < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket bastion"
  homepage "https://github.com/EnduranceLabs/journal-bastion"
  # url and sha256 are updated by packaging/homebrew/publish.sh.
  url "https://registry.npmjs.org/journal-bastion/-/journal-bastion-0.8.1.tgz"
  sha256 "b27d1445ca82eaed906363c881f9e1f04f3fc578e994fccb99b3c8cf2d285086"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "JOURNAL_BASTION_TOKEN is required",
      shell_output("#{bin}/journal-bastion 2>&1", 1)
  end
end
