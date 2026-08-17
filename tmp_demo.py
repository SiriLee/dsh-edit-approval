#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-edit-approval 显示效果测试文件
A demo module to verify syntax highlighting and diff rendering.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT: int = 60  # 从 30 提高到 60
MAX_RETRIES: int = 5


@dataclass
class ApprovalRequest:
    """一次审批请求的模型。"""

    action: str
    path: str
    reason: str = ""
    approved: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def summarize(self) -> str:
        status = "已批准" if self.approved else "待审批"
        return f"[{status}] {self.action} -> {self.path} ({self.reason})"


class ApprovalManager:
    """管理文件操作审批的入口类。"""

    def __init__(self, root: Path, policy: str = "ask") -> None:
        self.root = root.resolve()
        self.policy = policy
        self._requests: List[ApprovalRequest] = []

    def request(self, action: str, path: Path, **kw: Any) -> ApprovalRequest:
        req = ApprovalRequest(action=action, path=str(path), **kw)
        self._requests.append(req)

        if self.policy == "ask":
            # 触发人工审批
            logger.info("请求审批: %s", req.summarize())
        elif self.policy == "allow":
            req.approved = True
        elif self.policy == "deny":
            req.approved = False
        else:
            raise ValueError(f"未知策略: {self.policy}")

        return req

    def pending(self) -> List[ApprovalRequest]:
        """返回所有未批准的请求。"""
        return [r for r in self._requests if not r.approved]

    def count_pending(self) -> int:
        """统计待审批数量（新增方法）。"""
        return len(self.pending())

    def approve(self, req_id: int) -> bool:
        try:
            self._requests[req_id].approved = True
            return True
        except IndexError:
            return False


def parse_policy(raw: Optional[str] = None) -> str:
    """解析审批策略字符串。"""
    return (raw or "ask").strip().lower()


def main(argv: Optional[List[str]] = None) -> int:
    """入口函数。"""
    args = argv or []
    policy = parse_policy(args[0] if args else None)
    mgr = ApprovalManager(Path.cwd(), policy=policy)

    req = mgr.request("create", Path("tmp-demo.txt"), reason="display test")
    print(json.dumps(req.metadata, ensure_ascii=False, indent=2))
    return 0 if req.approved else 1


if __name__ == "__main__":
    raise SystemExit(main())
