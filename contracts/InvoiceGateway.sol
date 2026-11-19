// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IToken {
    function transferFrom(address,address,uint256) external returns(bool);
    function transfer(address,uint256) external returns(bool);
    function approve(address,uint256) external returns(bool);
}
interface IRouter {
    struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns(uint256);
}

/// Testnet invoice adapter. Tokens, supplier and router cannot be changed.
/// Each invoice ID can be paid only once by a given account, even within a batch.
contract InvoiceGateway {
    address public immutable usdc;
    address public immutable eurc;
    address public immutable router;
    address public immutable supplier;
    mapping(address => mapping(bytes32 => bool)) public paid;
    bool private entered;
    event InvoicePaid(address indexed account, bytes32 indexed invoiceId, uint256 euros, uint256 dollars);
    constructor(address u,address e,address r,address s) {
        require(u != address(0) && e != address(0) && r != address(0) && s != address(0), "zero address");
        usdc=u; eurc=e; router=r; supplier=s;
    }
    function payInvoice(bytes32 invoiceId,uint256 euros,uint256 maxDollars,uint256 deadline) external returns(uint256 spent) {
        require(!entered && !paid[msg.sender][invoiceId], "already paid");
        require(euros > 0 && maxDollars > 0 && block.timestamp <= deadline, "invalid invoice");
        entered=true;
        paid[msg.sender][invoiceId]=true;
        require(IToken(usdc).transferFrom(msg.sender,address(this),maxDollars), "funding failed");
        require(IToken(usdc).approve(router,maxDollars), "approval failed");
        spent=IRouter(router).exactOutputSingle(IRouter.ExactOutputSingleParams(usdc,eurc,100,supplier,deadline,euros,maxDollars,0));
        require(IToken(usdc).approve(router,0), "clear failed");
        if (maxDollars > spent) require(IToken(usdc).transfer(msg.sender,maxDollars-spent), "refund failed");
        emit InvoicePaid(msg.sender,invoiceId,euros,spent);
        entered=false;
    }
}
