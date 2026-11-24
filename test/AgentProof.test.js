const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentProof", function () {
  let registry, proof, issuer, recipient, outsider, nonHolderRecipient;

  beforeEach(async function () {
    [, issuer, recipient, outsider, nonHolderRecipient] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockAgentID");
    registry = await Mock.deploy();
    const Proof = await ethers.getContractFactory("AgentProof");
    proof = await Proof.deploy(await registry.getAddress());
    // issuer + recipient hold Agent IDs; outsider also holds one (for the
    // "non-recipient cannot confirm" case); nonHolderRecipient does not.
    await registry.setHolder(issuer.address, true);
    await registry.setHolder(recipient.address, true);
    await registry.setHolder(outsider.address, true);
  });

  async function issue(from = issuer, to = recipient.address) {
    return proof.connect(from).issueReceipt(to, 0, "Delivered the audit report", "ipfs://evidence-1");
  }

  it("holder -> holder issue succeeds and creates a pending receipt", async function () {
    await expect(issue()).to.emit(proof, "ReceiptIssued");
    expect(await proof.totalReceipts()).to.equal(1n);
    const r = await proof.getReceipt(0);
    expect(r.issuer).to.equal(issuer.address);
    expect(r.recipient).to.equal(recipient.address);
    expect(r.status).to.equal(0n); // Pending
    expect(await proof.receivedCount(recipient.address)).to.equal(1n);
    expect(await proof.issuedCount(issuer.address)).to.equal(1n);
  });

  it("non-holder cannot issue", async function () {
    await expect(
      proof.connect(nonHolderRecipient).issueReceipt(recipient.address, 0, "x", "")
    ).to.be.revertedWith("issuer holds no Agent ID");
  });

  it("holder -> non-holder cannot issue", async function () {
    await expect(issue(issuer, nonHolderRecipient.address)).to.be.revertedWith(
      "recipient holds no Agent ID"
    );
  });

  it("self-issue reverts", async function () {
    await expect(issue(issuer, issuer.address)).to.be.revertedWith("cannot issue to yourself");
  });

  it("recipient confirm increments reputation for both sides", async function () {
    await issue();
    await expect(proof.connect(recipient).confirmReceipt(0)).to.emit(proof, "ReceiptConfirmed");
    const [recv, issuedConfirmed, issuedTotal] = await proof.reputationOf(recipient.address);
    expect(recv).to.equal(1n);
    expect(issuedConfirmed).to.equal(0n);
    expect(issuedTotal).to.equal(0n);
    const [iRecv, iConf, iTotal] = await proof.reputationOf(issuer.address);
    expect(iRecv).to.equal(0n);
    expect(iConf).to.equal(1n);
    expect(iTotal).to.equal(1n);
    const r = await proof.getReceipt(0);
    expect(r.status).to.equal(1n); // Confirmed
    expect(r.confirmedAt).to.be.gt(0n);
  });

  it("non-recipient cannot confirm", async function () {
    await issue();
    await expect(proof.connect(outsider).confirmReceipt(0)).to.be.revertedWith(
      "only the recipient can confirm"
    );
    await expect(proof.connect(issuer).confirmReceipt(0)).to.be.revertedWith(
      "only the recipient can confirm"
    );
  });

  it("double-confirm reverts", async function () {
    await issue();
    await proof.connect(recipient).confirmReceipt(0);
    await expect(proof.connect(recipient).confirmReceipt(0)).to.be.revertedWith(
      "receipt is not pending"
    );
  });

  it("issuer cancel works, and a cancelled receipt cannot be confirmed", async function () {
    await issue();
    await expect(proof.connect(issuer).cancelReceipt(0)).to.emit(proof, "ReceiptCancelled");
    const r = await proof.getReceipt(0);
    expect(r.status).to.equal(2n); // Cancelled
    await expect(proof.connect(recipient).confirmReceipt(0)).to.be.revertedWith(
      "receipt is not pending"
    );
    // reputation untouched
    const [recv] = await proof.reputationOf(recipient.address);
    expect(recv).to.equal(0n);
  });

  it("non-issuer cannot cancel", async function () {
    await issue();
    await expect(proof.connect(recipient).cancelReceipt(0)).to.be.revertedWith(
      "only the issuer can cancel"
    );
  });

  it("rejects bad inputs: category, empty title, overlong title", async function () {
    await expect(
      proof.connect(issuer).issueReceipt(recipient.address, 6, "ok", "")
    ).to.be.revertedWith("invalid category");
    await expect(
      proof.connect(issuer).issueReceipt(recipient.address, 0, "", "")
    ).to.be.revertedWith("title must be 1-140 bytes");
    await expect(
      proof.connect(issuer).issueReceipt(recipient.address, 0, "a".repeat(141), "")
    ).to.be.revertedWith("title must be 1-140 bytes");
  });

  it("paginated id getters work", async function () {
    await issue();
    await issue();
    expect(await proof.receivedIdsOf(recipient.address, 0, 10)).to.deep.equal([0n, 1n]);
    expect(await proof.receivedIdsOf(recipient.address, 1, 1)).to.deep.equal([1n]);
    expect(await proof.issuedIdsOf(issuer.address, 5, 10)).to.deep.equal([]);
  });

  it("hasAgentId mirrors the registry", async function () {
    expect(await proof.hasAgentId(issuer.address)).to.equal(true);
    expect(await proof.hasAgentId(nonHolderRecipient.address)).to.equal(false);
  });
});
